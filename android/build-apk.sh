#!/usr/bin/env bash
# ==========================================================================
# build-apk.sh — 不依赖 Gradle 的 APK 构建脚本
#
#   aapt2 compile → aapt2 link → javac → d8 → 注入 dex → zipalign → apksigner
#
# 用法：bash android/build-apk.sh
# 依赖：JDK 17（BMFM_JDK）、Android SDK build-tools 34 + platforms/android-34
# ==========================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ANDROID_DIR="$ROOT/android"
BUILD="$ANDROID_DIR/build"
PKG_DIR="com/bmfreemusic/app"

SDK="${ANDROID_HOME:-${LOCALAPPDATA:-$HOME/AppData/Local}/Android/Sdk}"
BT="$SDK/build-tools/34.0.0"
ANDROID_JAR="$SDK/platforms/android-34/android.jar"

JDK="${BMFM_JDK:-$ROOT/.buildenv/jdk-17.0.21+9}"
# JAVA_HOME 必须是 Windows 风格路径（d8.bat / apksigner.bat 会直接使用）
if command -v cygpath >/dev/null 2>&1; then
  export JAVA_HOME="$(cygpath -m "$JDK")"
else
  export JAVA_HOME="$JDK"
fi
export PATH="$JAVA_HOME/bin:$PATH"

# Python 只用来往 APK 里塞 classes.dex
PY="${BMFM_PYTHON:-}"
if [ -z "$PY" ]; then
  if command -v python >/dev/null 2>&1; then PY="$(command -v python)"
  elif command -v python3 >/dev/null 2>&1; then PY="$(command -v python3)"
  else PY="$ROOT/.buildenv/python/python.exe"; fi
fi

KS="$ANDROID_DIR/bmfm.keystore"
KS_PASS="bmfm123456"
KS_ALIAS="bmfm"
OUT="$ROOT/BMFreeMusic.apk"

say() { printf '\n\033[36m==> %s\033[0m\n' "$1"; }
fail() { printf '\033[31m[x] %s\033[0m\n' "$1"; exit 1; }

say "检查构建环境"
[ -x "$JAVA_HOME/bin/java" ] || [ -x "$JAVA_HOME/bin/java.exe" ] || fail "找不到 JDK：$JDK"
[ -f "$ANDROID_JAR" ] || fail "找不到 android.jar：$ANDROID_JAR"
[ -x "$BT/aapt2.exe" ] || [ -x "$BT/aapt2" ] || fail "找不到 aapt2"
[ -x "$PY" ] || fail "找不到 Python：$PY"
echo "  JDK        : $("$JAVA_HOME/bin/java" -version 2>&1 | head -1)"
echo "  android.jar: $ANDROID_JAR"
echo "  python     : $PY"

say "清理"
rm -rf "$BUILD"
mkdir -p "$BUILD/compiled" "$BUILD/classes" "$BUILD/dex"

say "同步前端资源到 assets"
rm -rf "$ANDROID_DIR/assets"
mkdir -p "$ANDROID_DIR/assets"
cp "$ROOT/index.html" "$ANDROID_DIR/assets/"
cp -r "$ROOT/src" "$ANDROID_DIR/assets/"
cp -r "$ROOT/assets" "$ANDROID_DIR/assets/"
cp "$ROOT/manifest.webmanifest" "$ANDROID_DIR/assets/" 2>/dev/null || true
echo "  assets: $(find "$ANDROID_DIR/assets" -type f | wc -l) 个文件"

say "1/6 aapt2 compile"
"$BT/aapt2.exe" compile --dir "$ANDROID_DIR/res" -o "$BUILD/compiled/res.zip"

say "2/6 aapt2 link"
"$BT/aapt2.exe" link \
  -o "$BUILD/base.apk" \
  -I "$ANDROID_JAR" \
  --manifest "$ANDROID_DIR/AndroidManifest.xml" \
  -R "$BUILD/compiled/res.zip" \
  -A "$ANDROID_DIR/assets" \
  --min-sdk-version 23 \
  --target-sdk-version 34 \
  --auto-add-overlay \
  --java "$BUILD/gen"
echo "  base.apk: $(du -h "$BUILD/base.apk" | cut -f1)"

say "3/6 javac"
# 全程用相对路径，避免 Windows 程序读不懂 MSYS 的 /d/... 绝对路径
cd "$ANDROID_DIR"
find java build/gen -name "*.java" > build/sources.txt
echo "  源文件: $(wc -l < build/sources.txt) 个"
"$JAVA_HOME/bin/javac" \
  -source 8 -target 8 \
  -bootclasspath "$(cygpath -m "$ANDROID_JAR" 2>/dev/null || echo "$ANDROID_JAR")" \
  -classpath "$(cygpath -m "$ANDROID_JAR" 2>/dev/null || echo "$ANDROID_JAR")" \
  -encoding UTF-8 -nowarn \
  -d build/classes \
  @build/sources.txt 2>&1 | grep -v "deprecat\|ע:" || true
# javac 有错就必须停：只看 class 数量不够（一个文件编译失败，其它照样能编出十几个 class）
if [ "$(find build/classes -name '*.class' 2>/dev/null | wc -l)" -lt 10 ]; then
  echo "  ✘ javac 失败，classes 数量异常，终止构建" >&2
  exit 1
fi
# 每个源文件都必须有对应的 class，否则视为编译失败
MISSING=0
while read -r src; do
  rel="${src%.java}"
  rel="${rel#java/}"          # 源码在 java/ 下，但 javac 按包名输出
  rel="${rel#build/gen/}"
  cls="build/classes/${rel}.class"
  if [ ! -f "$cls" ]; then
    echo "  ✘ 缺少 class: $cls（源文件编译失败）" >&2
    MISSING=$((MISSING+1))
  fi
done < build/sources.txt
if [ "$MISSING" -gt 0 ]; then
  echo "  ✘ javac 有 $MISSING 个源文件编译失败，终止构建" >&2
  exit 1
fi
echo "  class: $(find build/classes -name '*.class' | wc -l) 个"

say "4/6 d8"
"$BT/d8.bat" \
  --release --min-api 23 \
  --lib "$(cygpath -m "$ANDROID_JAR" 2>/dev/null || echo "$ANDROID_JAR")" \
  --output build/dex \
  build/classes/$PKG_DIR/*.class
echo "  classes.dex: $(du -h build/dex/classes.dex | cut -f1)"

say "5/6 组装 APK"
cat > "$BUILD/pack.py" <<'PYEOF'
import sys, os, zipfile, shutil
build = sys.argv[1]
base = os.path.join(build, 'base.apk')
out = os.path.join(build, 'unsigned.apk')
dex = os.path.join(build, 'dex', 'classes.dex')

if os.path.getsize(dex) < 100:
    raise SystemExit('classes.dex 异常，构建中止')

shutil.copy(base, out)
with zipfile.ZipFile(out, 'a', zipfile.ZIP_DEFLATED) as z:
    if 'classes.dex' in z.namelist():
        raise SystemExit('base.apk 里已存在 classes.dex')
    z.write(dex, 'classes.dex')

with zipfile.ZipFile(out) as z:
    names = z.namelist()
    print('  条目: %d  classes.dex=%s  assets=%d' % (
        len(names),
        'classes.dex' in names,
        sum(1 for n in names if n.startswith('assets/'))))
PYEOF
"$PY" build/pack.py build

say "6/6 zipalign + 签名"
"$BT/zipalign.exe" -p -f 4 build/unsigned.apk build/aligned.apk 2>/dev/null || \
  "$BT/zipalign.exe" -p -f 4 build/unsigned.apk build/aligned.apk

if [ ! -f "$KS" ]; then
  say "生成签名密钥（仅首次）"
  "$JAVA_HOME/bin/keytool" -genkeypair \
    -keystore bmfm.keystore -alias "$KS_ALIAS" \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -dname "CN=BM Free Music, OU=App, O=BM, L=Beijing, ST=Beijing, C=CN" \
    -noprompt
fi

"$BT/apksigner.bat" sign \
  --ks bmfm.keystore --ks-key-alias "$KS_ALIAS" \
  --ks-pass "pass:$KS_PASS" --key-pass "pass:$KS_PASS" \
  --out "../BMFreeMusic.apk" build/aligned.apk

"$BT/apksigner.bat" verify --verbose "../BMFreeMusic.apk" | head -6

cd "$ROOT"
say "完成"
echo "  产物: $OUT"
echo "  大小: $(du -h "$OUT" | cut -f1)"
