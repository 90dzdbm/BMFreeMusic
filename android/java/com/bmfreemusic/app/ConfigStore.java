package com.bmfreemusic.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Environment;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.Charset;

/**
 * ConfigStore —— 配置文件的多路径保存与加载
 *
 * 用户要求：配置文件优先放在「手机存储 / BMFreeMusic /」下面。
 * 放不进去（没有权限、目录建不出来）就换一个统一路径，优先级依次降低：
 *
 *   1. /sdcard/BMFreeMusic/bmfm_config.json      ← 手机存储/BMFreeMusic
 *   2. /sdcard/Android/data/<pkg>/files/BMFreeMusic/bmfm_config.json
 *   3. <应用私有目录>/BMFreeMusic/bmfm_config.json
 *   4. SharedPreferences（最后的兜底，永远可用）
 *
 * 写：永远写第一个能写成功的路径（新配置覆盖旧配置）。
 * 读：按上面的顺序扫描，取「最后修改时间最新」的那一份，
 *     这样从旧版本升级上来时，老目录里的配置也能被读到并迁移到新位置。
 */
public class ConfigStore {

    private static final String FILE_NAME = "bmfm_config.json";
    private static final String DIR_NAME = "BMFreeMusic";
    private static final String PREF_NAME = "bmfm_store";
    private static final String KEY_STATE = "state_json";

    private final Context ctx;
    private final SharedPreferences prefs;

    public ConfigStore(Context context) {
        this.ctx = context.getApplicationContext();
        this.prefs = this.ctx.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
    }

    /* ------------------------------------------------------------------
       候选路径（按优先级）
       ------------------------------------------------------------------ */
    private File[] candidates() {
        File[] list = new File[3];

        // 1. 手机存储/BMFreeMusic
        File sd = externalRoot();
        list[0] = sd == null ? null : new File(new File(sd, DIR_NAME), FILE_NAME);

        // 2. 应用专属外部目录（Android 11+ 无需权限也能写）
        File extFiles = ctx.getExternalFilesDir(null);
        list[1] = extFiles == null ? null : new File(new File(extFiles, DIR_NAME), FILE_NAME);

        // 3. 应用私有目录
        File files = ctx.getFilesDir();
        list[2] = files == null ? null : new File(new File(files, DIR_NAME), FILE_NAME);

        return list;
    }

    private File externalRoot() {
        try {
            if (!Environment.MEDIA_MOUNTED.equals(Environment.getExternalStorageState())) return null;
            return Environment.getExternalStorageDirectory();
        } catch (Throwable t) {
            return null;
        }
    }

    /** 当前实际在用的主路径（第一个存在且父目录可写的） */
    public String primaryPath() {
        File[] list = candidates();
        for (File f : list) {
            if (f == null) continue;
            File dir = f.getParentFile();
            if (dir != null && (dir.exists() || dir.mkdirs()) && dir.canWrite()) {
                return f.getAbsolutePath();
            }
        }
        return "";
    }

    /* ------------------------------------------------------------------
       读
       ------------------------------------------------------------------ */
    public String load() {
        long best = -1;
        String bestJson = null;

        File[] list = candidates();
        for (File f : list) {
            if (f == null || !f.exists()) continue;
            try {
                long m = f.lastModified();
                if (m <= best) continue;          // 只留最新的那份
                String s = readAll(f);
                if (s != null && s.length() > 1) {
                    best = m;
                    bestJson = s;
                }
            } catch (Throwable ignored) { }
        }

        if (bestJson != null) return bestJson;

        // 都没有就用 SharedPreferences 兜底
        try {
            return prefs.getString(KEY_STATE, "");
        } catch (Throwable t) {
            return "";
        }
    }

    /* ------------------------------------------------------------------
       写
       ------------------------------------------------------------------ */
    public boolean save(String json) {
        if (json == null || json.length() < 2) return false;

        boolean wrote = false;
        File[] list = candidates();
        for (File f : list) {
            if (f == null) continue;
            File dir = f.getParentFile();
            try {
                if (dir == null) continue;
                if (!dir.exists() && !dir.mkdirs()) continue;
                if (!dir.canWrite()) continue;
                writeAll(f, json);
                wrote = true;
                break;            // 只写第一个能写的路径，新配置覆盖旧配置
            } catch (Throwable ignored) { }
        }

        // 顺便写一份 SharedPreferences，双保险
        try {
            prefs.edit().putString(KEY_STATE, json).apply();
        } catch (Throwable ignored) { }

        return wrote;
    }

    public void clear() {
        File[] list = candidates();
        for (File f : list) {
            try {
                if (f != null && f.exists()) f.delete();
            } catch (Throwable ignored) { }
        }
        try {
            prefs.edit().remove(KEY_STATE).apply();
        } catch (Throwable ignored) { }
    }

    /* ------------------------------------------------------------------
       开屏媒体：也存在 BMFreeMusic 目录里
       ------------------------------------------------------------------ */
    /** 媒体目录（优先「手机存储/BMFreeMusic」，否则回退） */
    public File mediaDir() {
        File[] list = candidates();
        for (File f : list) {
            if (f == null) continue;
            File dir = f.getParentFile();
            if (dir != null && (dir.exists() || dir.mkdirs()) && dir.canWrite()) return dir;
        }
        File files = ctx.getFilesDir();
        File dir = new File(files, DIR_NAME);
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    /** 找一个可读的媒体文件 */
    public File mediaFile(String name) {
        if (name == null || name.isEmpty()) return null;
        if (name.contains("/") || name.contains("\\") || name.contains("..")) return null;
        File f = new File(mediaDir(), name);
        return (f.exists() && f.isFile()) ? f : null;
    }

    /** 保存一个媒体文件（开屏图/视频），返回文件名 */
    public String saveMedia(String filename, String mime, byte[] data) {
        if (data == null || data.length == 0) return null;
        String ext = guessExt(filename, mime);
        String safe = "splash_" + System.currentTimeMillis() + ext;
        try {
            File out = new File(mediaDir(), safe);
            FileOutputStream fos = new FileOutputStream(out);
            try {
                fos.write(data);
                fos.flush();
            } finally {
                try { fos.close(); } catch (Throwable ignored) { }
            }
            return safe;
        } catch (Throwable t) {
            return null;
        }
    }

    private String guessExt(String filename, String mime) {
        if (filename != null && filename.lastIndexOf('.') > 0) {
            String e = filename.substring(filename.lastIndexOf('.')).toLowerCase();
            if (e.length() <= 5 && e.matches("\\.[a-z0-9]+")) return e;
        }
        if (mime != null) {
            if (mime.contains("mp4")) return ".mp4";
            if (mime.contains("webm")) return ".webm";
            if (mime.contains("png")) return ".png";
            if (mime.contains("jpeg") || mime.contains("jpg")) return ".jpg";
            if (mime.contains("gif")) return ".gif";
        }
        return ".jpg";
    }

    /* ------------------------------------------------------------------
       工具
       ------------------------------------------------------------------ */
    private String readAll(File f) {
        FileInputStream in = null;
        try {
            in = new FileInputStream(f);
            java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            return new String(bos.toByteArray(), Charset.forName("UTF-8"));
        } catch (Throwable t) {
            return null;
        } finally {
            try { if (in != null) in.close(); } catch (Throwable ignored) { }
        }
    }

    private void writeAll(File f, String json) throws Exception {
        FileOutputStream out = null;
        try {
            out = new FileOutputStream(f);
            out.write(json.getBytes(Charset.forName("UTF-8")));
            out.flush();
            out.getFD().sync();
        } finally {
            try { if (out != null) out.close(); } catch (Throwable ignored) { }
        }
    }
}
