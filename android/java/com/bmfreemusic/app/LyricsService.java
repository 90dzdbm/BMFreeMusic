package com.bmfreemusic.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * LyricsService —— 桌面歌词
 *
 * 在别的应用上层开一个小窗，显示当前歌词行。
 * 歌词内容由前端的 player 事件推过来（见 src/js/ui/desklyrics.js）。
 *
 * 需要 SYSTEM_ALERT_WINDOW 权限；没有授权时，前端会先拉起系统授权页。
 */
public class LyricsService extends Service {
    /** Service 没有 runOnUiThread，用主线程 Handler 代替 */
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    public static LyricsService instance;

    private WindowManager wm;
    private LinearLayout root;
    private TextView tvCurrent;
    private TextView tvNext;
    private boolean attached = false;

    public static final String ACTION_START = "com.bmfreemusic.app.LYRICS_START";
    public static final String ACTION_STOP = "com.bmfreemusic.app.LYRICS_STOP";

    /* -------------------------------------------------------------- */

    public static void start(Context ctx) {
        Intent i = new Intent(ctx, LyricsService.class);
        i.setAction(ACTION_START);
        try {
            ctx.startService(i);
        } catch (Throwable ignored) { }
    }

    public static void stop(Context ctx) {
        Intent i = new Intent(ctx, LyricsService.class);
        i.setAction(ACTION_STOP);
        try {
            ctx.stopService(i);
        } catch (Throwable ignored) { }
        instance = null;
    }

    /** 是否有悬浮窗权限 */
    public static boolean canDraw(Activity act) {
        if (act == null) return false;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        try {
            return Settings.canDrawOverlays(act);
        } catch (Throwable t) {
            return false;
        }
    }

    /** 拉起系统授权页 */
    public static void requestPermission(Activity act) {
        if (act == null) return;
        try {
            Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + act.getPackageName()));
            act.startActivity(i);
        } catch (Throwable t) {
            try {
                act.startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION));
            } catch (Throwable ignored) { }
        }
    }

    /* -------------------------------------------------------------- */

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? ACTION_START : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            detach();
            stopSelf();
            return START_NOT_STICKY;
        }
        attach();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        detach();
        if (instance == this) instance = null;
        super.onDestroy();
    }

    /* -------------------------------------------------------------- */

    @SuppressLint({"SetJavaScriptEnabled"})
    private void attach() {
        if (attached) return;
        try {
            wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
            if (wm == null) return;

            root = new LinearLayout(this);
            root.setOrientation(LinearLayout.VERTICAL);
            root.setPadding(dp(18), dp(10), dp(18), dp(10));

            GradientDrawable bg = new GradientDrawable();
            bg.setColor(Color.argb(140, 0, 0, 0));
            bg.setCornerRadius(dp(16));
            root.setBackground(bg);

            tvCurrent = new TextView(this);
            tvCurrent.setTextColor(Color.WHITE);
            tvCurrent.setTextSize(17);
            tvCurrent.setGravity(Gravity.CENTER);
            tvCurrent.setMaxLines(2);
            root.addView(tvCurrent);

            tvNext = new TextView(this);
            tvNext.setTextColor(Color.argb(150, 255, 255, 255));
            tvNext.setTextSize(13);
            tvNext.setGravity(Gravity.CENTER);
            tvNext.setMaxLines(1);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT);
            lp.topMargin = dp(4);
            root.addView(tvNext, lp);

            WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                    WindowManager.LayoutParams.MATCH_PARENT,
                    WindowManager.LayoutParams.WRAP_CONTENT,
                    overlayType(),
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                            | WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                            | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                    android.graphics.PixelFormat.TRANSLUCENT);

            params.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
            params.y = dp(90);

            wm.addView(root, params);
            attached = true;
        } catch (Throwable ignored) {
            attached = false;
        }
    }

    private int overlayType() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY;
        }
        return WindowManager.LayoutParams.TYPE_PHONE;
    }

    private void detach() {
        if (!attached) return;
        try {
            if (wm != null && root != null) wm.removeView(root);
        } catch (Throwable ignored) { }
        attached = false;
        root = null;
        tvCurrent = null;
        tvNext = null;
    }

    /** 更新歌词内容 */
    public void update(final String current, final String next) {
        if (!attached) {
            attach();
            if (!attached) return;
        }
        try {
            mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    if (tvCurrent == null) return;
                    tvCurrent.setText(current == null ? "" : current);
                    tvNext.setText(next == null ? "" : next);
                }
            });
        } catch (Throwable ignored) { }
    }

    /** 调整悬浮窗位置（用户在屏幕上拖动后调用） */
    public void move(final int y) {
        if (!attached) return;
        try {
            mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    try {
                        WindowManager.LayoutParams p = (WindowManager.LayoutParams) root.getLayoutParams();
                        p.y = y;
                        wm.updateViewLayout(root, p);
                    } catch (Throwable ignored) { }
                }
            });
        } catch (Throwable ignored) { }
    }

    private int dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density + 0.5f);
    }
}
