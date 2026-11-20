package com.bmfreemusic.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.DownloadManager;
import android.app.Dialog;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;

/**
 * MainActivity —— WebView 外壳
 *
 * 除了承载前端，还提供两项原生能力：
 *   1. 尺寸锁定：禁止任何形式的缩放，界面比例固定
 *   2. 网页登录：在应用内打开平台登录页，登录成功后自动抓取 Cookie 回传给前端
 */
public class MainActivity extends Activity {

    private WebView web;
    private LocalServer server;
    private long lastBackPressed = 0;
    private volatile boolean canGoBack = false;

    /* 各平台的登录页与「登录成功」判据（出现该 Cookie 即视为已登录） */
    private static final Map<String, String> LOGIN_URLS = new HashMap<>();
    private static final Map<String, String[]> LOGIN_KEYS = new HashMap<>();
    static {
        // 直接指向各平台的登录页，而不是首页——首页要用户自己找登录按钮，
        // 而且移动版首页常常把入口藏在抽屉里，等于点进去什么也干不了。
        LOGIN_URLS.put("netease", "https://music.163.com/#/login");
        LOGIN_URLS.put("qq", "https://y.qq.com/portal/profile.html");
        LOGIN_URLS.put("kugou", "https://m.kugou.com/user/login");
        LOGIN_URLS.put("kuwo", "https://www.kuwo.cn/login");
        LOGIN_URLS.put("migu", "https://music.migu.cn/v3/personal/login");
        LOGIN_URLS.put("bilibili", "https://passport.bilibili.com/login");

        LOGIN_KEYS.put("netease", new String[]{"MUSIC_U"});
        LOGIN_KEYS.put("qq", new String[]{"qm_keyst", "qqmusic_key"});
        LOGIN_KEYS.put("kugou", new String[]{"KuGoo", "kg_mid_ss"});
        LOGIN_KEYS.put("kuwo", new String[]{"kw_token"});
        LOGIN_KEYS.put("migu", new String[]{"uid", "token"});
        LOGIN_KEYS.put("bilibili", new String[]{"SESSDATA"});
    }

    private static final Map<String, String> NAMES = new HashMap<>();
    static {
        NAMES.put("netease", "网易云音乐");
        NAMES.put("qq", "QQ 音乐");
        NAMES.put("kugou", "酷狗音乐");
        NAMES.put("kuwo", "酷我音乐");
        NAMES.put("migu", "咪咕音乐");
        NAMES.put("bilibili", "哔哩哔哩");
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window w = getWindow();
        w.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        try {
            server = new LocalServer(getApplicationContext());
            int port = server.start();

            web = new WebView(this);
            web.setLayoutParams(new ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            web.setBackgroundColor(Color.parseColor("#f8fafd"));
            web.setOverScrollMode(View.OVER_SCROLL_NEVER);
            setContentView(web);

            WebSettings s = web.getSettings();
            s.setJavaScriptEnabled(true);
            s.setDomStorageEnabled(true);
            s.setDatabaseEnabled(true);
            s.setMediaPlaybackRequiresUserGesture(false);
            s.setAllowFileAccess(false);
            s.setAllowContentAccess(true);

            // ---- 尺寸锁定：任何情况下都不缩放 ----
            s.setSupportZoom(false);
            s.setBuiltInZoomControls(false);
            s.setDisplayZoomControls(false);
            s.setTextZoom(100);                 // 忽略系统字体大小
            s.setUseWideViewPort(false);        // 1 CSS px = 1 dp
            s.setLoadWithOverviewMode(false);   // 不为了「一屏显示」而整页缩小

            // 覆盖安装不完整的最常见原因：WebView 缓存目录在升级后仍然保留，
            // 旧 JS/CSS 被继续命中，用户看到的就是「装了新包但没变化」。
            // 这里直接不让它缓存任何东西。
            s.setCacheMode(WebSettings.LOAD_NO_CACHE);
            try {
                web.clearCache(true);
                web.clearFormData();
                web.clearHistory();
                web.clearSslPreferences();
            } catch (Exception ignored) { }
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            s.setUserAgentString(
                    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 " +
                    "(KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36");

            web.setWebChromeClient(new WebChromeClient());
            web.setWebViewClient(new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, String url) {
                    if (url.startsWith("http://127.0.0.1")) return false;
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                    } catch (Exception ignored) { }
                    return true;
                }
            });

            web.addJavascriptInterface(new NativeBridge(), "BMFMAndroid");
            web.loadUrl("http://127.0.0.1:" + port + "/index.html");
            // 装完新包首次启动也清一次缓存
            web.postDelayed(new Runnable() {
                @Override
                public void run() {
                    try { web.clearCache(true); } catch (Exception ignored) { }
                }
            }, 1500);

            setupPlaybackService();
            requestNotifyPermission();
        } catch (Exception e) {
            Toast.makeText(this, "启动失败：" + e.getMessage(), Toast.LENGTH_LONG).show();
            finish();
        }
    }

    /* ======================================================================
       通知栏播放控制
       ====================================================================== */
    private void setupPlaybackService() {
        try {
            Intent i = new Intent(this, PlaybackService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(i);
            } else {
                startService(i);
            }
        } catch (Exception ignored) { }

        // 通知栏按钮 → WebView
        PlaybackService.bridge = new PlaybackService.Bridge() {
            @Override
            public void onCommand(final String action) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (web == null) return;
                        web.evaluateJavascript(
                                "window.__bmfmCommand && window.__bmfmCommand('" + action + "')", null);
                    }
                });
            }
        };
    }

    private void requestNotifyPermission() {
        if (Build.VERSION.SDK_INT >= 33) {
            try {
                if (checkSelfPermission("android.permission.POST_NOTIFICATIONS")
                        != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 1001);
                }
            } catch (Exception ignored) { }
        }
    }

    /* ======================================================================
       给前端调用的原生桥
       ====================================================================== */
    private class NativeBridge {
        @JavascriptInterface
        public boolean available() {
            return true;
        }

        @JavascriptInterface
        public String platform() {
            return "android";
        }

        /** 打开平台网页登录，登录成功后回调 window.__bmfmLoginResult */
        @JavascriptInterface
        public void openLogin(final String source) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    showLogin(source);
                }
            });
        }

        @JavascriptInterface
        public void toast(final String msg) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show();
                }
            });
        }

        /**
         * 前端每次路由/浮层变化都会同步一次，
         * 物理返回键据此决定「返回上一级」还是「双击退出」。
         */
        @JavascriptInterface
        public void setCanGoBack(boolean can) {
            canGoBack = can;
        }

        /* ---------------- 原生持久化 ----------------
         * WebView 的 localStorage 依赖 origin，一旦端口变了或数据被系统清掉就全没。
         * 这里再落一份到 SharedPreferences，双保险。
         */
        @JavascriptInterface
        public String loadStore() {
            try {
                return configStore().load();
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public void saveStore(String json) {
            if (json == null || json.length() < 2) return;
            try {
                configStore().save(json);
            } catch (Exception ignored) { }
        }

        @JavascriptInterface
        public void clearStore() {
            try {
                configStore().clear();
            } catch (Exception ignored) { }
        }

        /* ---------------- 开屏媒体 ---------------- */

        /** 前端把文件读成 base64 传过来，落到 手机存储/BMFreeMusic/ */
        @JavascriptInterface
        public String saveMedia(final String filename, final String mime, final String base64) {
            if (base64 == null || base64.length() < 8) return null;
            try {
                byte[] data = android.util.Base64.decode(base64, android.util.Base64.DEFAULT);
                return configStore().saveMedia(filename, mime, data);
            } catch (Exception e) {
                return null;
            }
        }

        /** 媒体文件的可访问地址 */
        @JavascriptInterface
        public String mediaUrl(final String name) {
            if (name == null || name.isEmpty()) return null;
            try {
                File f = configStore().mediaFile(name);
                if (f == null) return null;
                return "http://127.0.0.1:" + server.port + "/api/media?f=" + Uri.encode(f.getName());
            } catch (Exception ignored) {
                return null;
            }
        }

        /* ---------------- 桌面歌词 ---------------- */

        @JavascriptInterface
        public boolean canDrawOverlay() {
            return LyricsService.canDraw(MainActivity.this);
        }

        @JavascriptInterface
        public void requestOverlayPermission() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    LyricsService.requestPermission(MainActivity.this);
                }
            });
        }

        @JavascriptInterface
        public void enableDeskLyrics() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    LyricsService.start(MainActivity.this);
                }
            });
        }

        @JavascriptInterface
        public void disableDeskLyrics() {
            LyricsService.stop(MainActivity.this);
        }

        @JavascriptInterface
        public void updateDeskLyrics(String current, String next) {
            LyricsService s = LyricsService.instance;
            if (s != null) s.update(current, next);
        }

        /** 当前配置文件的实际路径，设置页里给用户看 */
        @JavascriptInterface
        public String configPath() {
            try {
                return configStore().primaryPath();
            } catch (Exception ignored) {
                return "";
            }
        }

        /** 播放状态推给通知栏 */
        @JavascriptInterface
        public void updatePlayback(final String json) {
            if (json == null) return;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        if (PlaybackService.instance == null) setupPlaybackService();
                        if (PlaybackService.instance != null) {
                            PlaybackService.instance.updateFromJson(json);
                        }
                    } catch (Exception ignored) { }
                }
            });
        }

        /** 交给系统 DownloadManager 下载到 Music 目录 */
        @JavascriptInterface
        public void download(final String url, final String filename) {
            if (url == null || url.isEmpty()) return;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                        if (dm == null) {
                            Toast.makeText(MainActivity.this, "下载服务不可用", Toast.LENGTH_SHORT).show();
                            return;
                        }
                        DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
                        req.setTitle(filename);
                        req.setDescription("BM Free Music");
                        req.setMimeType("audio/mpeg");
                        req.setNotificationVisibility(
                                DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                        req.setDestinationInExternalPublicDir(
                                Environment.DIRECTORY_MUSIC, filename);
                        req.allowScanningByMediaScanner();
                        dm.enqueue(req);
                    } catch (Exception e) {
                        Toast.makeText(MainActivity.this,
                                "下载失败：" + e.getMessage(), Toast.LENGTH_LONG).show();
                    }
                }
            });
        }

        /**
         * 下载新版本并拉起安装器。
         * 自己用 HttpURLConnection 下而不是丢给 DownloadManager：
         * 需要在下载结束后立刻装、并把进度回传给页面。
         */
        @JavascriptInterface
        public void updateApk(final String url, final String filename) {
            if (url == null || url.isEmpty()) return;
            new Thread(new Runnable() {
                @Override
                public void run() {
                    HttpURLConnection conn = null;
                    try {
                        conn = (HttpURLConnection) new URL(url).openConnection();
                        conn.setConnectTimeout(20000);
                        conn.setReadTimeout(40000);
                        conn.setInstanceFollowRedirects(true);
                        conn.setRequestProperty("User-Agent",
                                "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36");
                        conn.connect();
                        int code = conn.getResponseCode();
                        if (code != 200) {
                            toastUi("更新下载失败：HTTP " + code);
                            return;
                        }
                        int total = conn.getContentLength();
                        File out = new File(getCacheDir(), "update.apk");
                        if (out.exists()) out.delete();

                        InputStream in = conn.getInputStream();
                        FileOutputStream fos = new FileOutputStream(out);
                        byte[] buf = new byte[16384];
                        long done = 0;
                        int lastPct = -5;
                        int n;
                        while ((n = in.read(buf)) > 0) {
                            fos.write(buf, 0, n);
                            done += n;
                            if (total > 0) {
                                int pct = (int) (done * 100 / total);
                                if (pct - lastPct >= 5) {
                                    lastPct = pct;
                                    notifyProgress(pct);
                                }
                            }
                        }
                        fos.flush();
                        fos.close();
                        in.close();
                        conn.disconnect();   // 下载结束立刻断开，不再占用代理连接
                        conn = null;

                        if (out.length() < 50000) {
                            toastUi("更新包不完整，请重试");
                            return;
                        }
                        notifyProgress(100);
                        installApk();
                    } catch (Exception e) {
                        toastUi("更新下载失败：" + e.getMessage());
                    } finally {
                        if (conn != null) conn.disconnect();
                    }
                }
            }).start();
        }

        @JavascriptInterface
        public void hidePlayback() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        if (PlaybackService.instance != null) {
                            PlaybackService.instance.clearNotification();
                        }
                    } catch (Exception ignored) { }
                }
            });
        }
    }

    private static final String PREF_NAME = "bmfm_store";
    private static final String KEY_STATE = "state_json";

    private ConfigStore configStore;

    /** 配置存储：优先 手机存储/BMFreeMusic/，放不下再退到别的统一路径 */
    private ConfigStore configStore() {
        if (configStore == null) configStore = new ConfigStore(this);
        return configStore;
    }

    private android.content.SharedPreferences prefs() {
        return getSharedPreferences(PREF_NAME, MODE_PRIVATE);
    }

    /** 让前端立刻把内存里的数据落盘（退出/切后台前调用） */
    private void flushWebStore() {
        if (web == null) return;
        try {
            web.evaluateJavascript(
                    "try{window.bmfm&&window.bmfm.store&&window.bmfm.store.flush()}catch(e){}", null);
        } catch (Exception ignored) { }
    }

    /* ======================================================================
       平台网页登录
       ====================================================================== */
    private void toastUi(final String msg) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show();
            }
        });
    }

    private void notifyProgress(final int pct) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    if (web != null) {
                        web.evaluateJavascript(
                                "window.__bmfmUpdateProgress&&window.__bmfmUpdateProgress(" + pct + ")",
                                null);
                    }
                } catch (Exception ignored) { }
                if (pct == 100) {
                    Toast.makeText(MainActivity.this, "下载完成，正在打开安装器", Toast.LENGTH_SHORT).show();
                }
            }
        });
    }

    private void installApk() {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    Intent i = new Intent(Intent.ACTION_VIEW);
                    i.setDataAndType(ApkProvider.CONTENT_URI,
                            "application/vnd.android.package-archive");
                    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                            | Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(i);
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this,
                            "无法拉起安装器：" + e.getMessage(), Toast.LENGTH_LONG).show();
                }
            }
        });
    }

    private void showLogin(final String source) {
        final String url = LOGIN_URLS.get(source);
        if (url == null) {
            Toast.makeText(this, "暂不支持该平台", Toast.LENGTH_SHORT).show();
            return;
        }

        final Dialog dlg = new Dialog(this, android.R.style.Theme_Black_NoTitleBar);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.parseColor("#f8fafd"));

        // 顶部栏
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackgroundColor(Color.parseColor("#ffffff"));
        bar.setPadding(dp(12), dp(8), dp(12), dp(8));

        TextView close = new TextView(this);
        close.setText("✕");
        close.setTextSize(20);
        close.setTextColor(Color.parseColor("#444746"));
        close.setPadding(dp(8), dp(4), dp(16), dp(4));
        close.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                dlg.dismiss();
            }
        });

        TextView title = new TextView(this);
        title.setText("登录 " + NAMES.get(source));
        title.setTextSize(16);
        title.setTextColor(Color.parseColor("#1f1f1f"));
        LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        tp.leftMargin = dp(4);

        TextView hint = new TextView(this);
        hint.setText("登录成功会自动返回");
        hint.setTextSize(11);
        hint.setTextColor(Color.parseColor("#747775"));

        bar.addView(close);
        bar.addView(title, tp);
        bar.addView(hint);
        root.addView(bar, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        // 登录用 WebView
        final WebView loginWeb = new WebView(this);
        WebSettings ls = loginWeb.getSettings();
        ls.setJavaScriptEnabled(true);
        ls.setDomStorageEnabled(true);
        ls.setDatabaseEnabled(true);
        ls.setUseWideViewPort(true);
        ls.setLoadWithOverviewMode(true);
        ls.setBuiltInZoomControls(true);
        ls.setDisplayZoomControls(false);
        ls.setSupportZoom(true);
        ls.setUserAgentString(
                "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 " +
                "(KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36");

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(loginWeb, true);

        loginWeb.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String u) {
                return false; // 登录流程全在弹窗内完成
            }
        });
        loginWeb.loadUrl(url);

        LinearLayout.LayoutParams wp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
        root.addView(loginWeb, wp);

        dlg.setContentView(root);
        dlg.setCanceledOnTouchOutside(false);
        dlg.setOnKeyListener(new Dialog.OnKeyListener() {
            @Override
            public boolean onKey(android.content.DialogInterface d, int keyCode, KeyEvent event) {
                if (keyCode == KeyEvent.KEYCODE_BACK) {
                    dlg.dismiss();
                    return true;
                }
                return false;
            }
        });
        dlg.show();

        // 每 1.2 秒检查一次 Cookie，命中登录判据就收网
        final Handler handler = new Handler(Looper.getMainLooper());
        final String[] keys = LOGIN_KEYS.get(source);
        final Runnable[] task = new Runnable[1];
        final long deadline = System.currentTimeMillis() + 5 * 60 * 1000;

        task[0] = new Runnable() {
            @Override
            public void run() {
                if (!dlg.isShowing()) return;
                if (System.currentTimeMillis() > deadline) {
                    handler.removeCallbacks(task[0]);
                    return;
                }

                String cookie = null;
                try {
                    cookie = CookieManager.getInstance().getCookie(url);
                } catch (Exception ignored) { }

                String hit = matchKey(cookie, keys);
                if (hit != null) {
                    handler.removeCallbacks(task[0]);
                    deliverLogin(source, cookie);
                    Toast.makeText(MainActivity.this,
                            NAMES.get(source) + " 登录成功", Toast.LENGTH_SHORT).show();
                    dlg.dismiss();
                    return;
                }
                handler.postDelayed(task[0], 1200);
            }
        };
        handler.postDelayed(task[0], 1200);

        dlg.setOnDismissListener(new android.content.DialogInterface.OnDismissListener() {
            @Override
            public void onDismiss(android.content.DialogInterface di) {
                handler.removeCallbacks(task[0]);
                try {
                    loginWeb.loadUrl("about:blank");
                    loginWeb.destroy();
                } catch (Exception ignored) { }
            }
        });
    }

    private String matchKey(String cookie, String[] keys) {
        if (cookie == null || keys == null) return null;
        for (String k : keys) {
            if (cookie.contains(k + "=")) return k;
        }
        return null;
    }

    /** 把 Cookie 交回前端 */
    private void deliverLogin(String source, String cookie) {
        if (web == null) return;
        try {
            JSONObject obj = new JSONObject();
            obj.put("source", source);
            obj.put("cookie", cookie == null ? "" : cookie);
            String arg = JSONObject.quote(obj.toString());
            web.evaluateJavascript(
                    "window.__bmfmLoginResult && window.__bmfmLoginResult(" + arg + ")", null);
        } catch (Exception ignored) { }
    }

    private int dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density + 0.5f);
    }

    /* ======================================================================
       系统事件
       ====================================================================== */
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            // 有上一级（子页面 / 浮层 / 队列抽屉）就先返回
            if (canGoBack && web != null) {
                web.evaluateJavascript(
                        "window.__bmfmBack && window.__bmfmBack()", null);
                return true;
            }
            // 已经在根页面：双击退出
            long now = System.currentTimeMillis();
            if (now - lastBackPressed < 2000) {
                return super.onKeyDown(keyCode, event);
            }
            lastBackPressed = now;
            Toast.makeText(this, "再按一次退出", Toast.LENGTH_SHORT).show();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onPause() {
        super.onPause();
        flushWebStore();          // 切后台先把数据落盘
        if (web != null) web.onPause();
    }

    @Override
    protected void onStop() {
        super.onStop();
        flushWebStore();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onDestroy() {
        if (server != null) server.stop();
        if (web != null) {
            try {
                web.loadUrl("about:blank");
                web.destroy();
            } catch (Exception ignored) { }
        }
        super.onDestroy();
    }
}
