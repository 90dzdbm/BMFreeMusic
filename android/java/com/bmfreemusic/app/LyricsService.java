package com.bmfreemusic.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.net.Uri;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.WindowManager;
import android.widget.TextView;

/**
 * LyricsService —— 桌面歌词
 *
 * 在别的应用上层开一个小窗，只显示当前这一句歌词：
 *   - 无背景（纯文字 + 阴影，靠对比度读）
 *   - 可以用手指拖动
 *   - 本软件处于前台时自动隐藏（回前台 -> 隐藏；退到后台 -> 回来）
 *
 * 稳定性要点（之前偶发崩溃就是踩了这些坑）：
 *   1. addView / updateViewLayout 只能在主线程做 —— 全部走 mainHandler.post
 *   2. 不用 FLAG_LAYOUT_NO_LIMITS、不用 MATCH_PARENT 宽度（部分 ROM 直接崩）
 *   3. 每次操作前检查 root.getWindowToken() != null，否则说明窗口已被系统回收
 *   4. detach() 与 attach() 加锁串行化，避免竞态导致 "View not attached"
 *   5. 所有 addView/removeView 都有 try/catch，失败只降级不崩
 */
public class LyricsService extends Service {
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Object lock = new Object();

    public static LyricsService instance;

    private WindowManager wm;
    private TextView tvCurrent;
    private View root;
    private boolean attached = false;
    /** 用户手动拖动后记住位置 */
    private int savedX = -1;
    private int savedY = -1;
    /** 软件在前台时隐藏悬浮窗（默认在前台，开屏时不会盖住自己的界面） */
    private boolean appForeground = true;
    private boolean userEnabled = false;

    /** 歌词颜色（#RRGGBB）与不透明度（0~1） */
    private int textColor = Color.WHITE;
    private float textAlpha = 1f;
    /** 可拖动模式：开启后窗口才接收触摸事件（否则会挡住其它应用的点击） */
    private boolean touchable = false;

    private int downX, downY, startX, startY;
    private boolean dragging = false;
    private int touchSlop;

    public static final String ACTION_START = "com.bmfreemusic.app.LYRICS_START";
    public static final String ACTION_STOP = "com.bmfreemusic.app.LYRICS_STOP";
    private static final String PREF = "bmfm_lyrics";

    /* -------------------------------------------------------------- */

    public static void start(Context ctx) {
        if (ctx == null) return;
        Intent i = new Intent(ctx, LyricsService.class);
        i.setAction(ACTION_START);
        try {
            ctx.startService(i);
        } catch (Throwable ignored) { }
    }

    public static void stop(Context ctx) {
        if (ctx == null) return;
        Intent i = new Intent(ctx, LyricsService.class);
        i.setAction(ACTION_STOP);
        try {
            ctx.stopService(i);
        } catch (Throwable ignored) { }
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
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            act.startActivity(i);
        } catch (Throwable t) {
            try {
                Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                act.startActivity(i);
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
        loadPos();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? ACTION_START : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        userEnabled = true;
        // 一定要在主线程操作窗口
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                attach();
            }
        });
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                detach();
            }
        });
        if (instance == this) instance = null;
        super.onDestroy();
    }

    /* -------------------------------------------------------------- */

    private void loadPos() {
        try {
            SharedPreferences p = getSharedPreferences(PREF, Context.MODE_PRIVATE);
            savedX = p.getInt("x", -1);
            savedY = p.getInt("y", -1);
        } catch (Throwable ignored) { }
    }

    private void savePos(int x, int y) {
        savedX = x;
        savedY = y;
        try {
            getSharedPreferences(PREF, Context.MODE_PRIVATE)
                    .edit().putInt("x", x).putInt("y", y).apply();
        } catch (Throwable ignored) { }
    }

    @SuppressLint({"SetJavaScriptEnabled"})
    private void attach() {
        synchronized (lock) {
            if (attached) {
                applyVisibility();
                return;
            }
            try {
                wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
                if (wm == null) return;

                root = new TextView(this);
                tvCurrent = (TextView) root;
                tvCurrent.setTextColor(textColor);
                tvCurrent.setTextSize(16);
                tvCurrent.setGravity(Gravity.CENTER);
                tvCurrent.setMaxLines(2);
                tvCurrent.setSingleLine(false);
                // 无背景，只加阴影保证在浅色背景上也看得清
                applyTextAlpha();
                tvCurrent.setShadowLayer(dp(6), 0f, dp(1), Color.argb(220, 0, 0, 0));
                tvCurrent.setPadding(dp(14), dp(8), dp(14), dp(8));
                tvCurrent.setText("♪");

                final int slop = ViewConfiguration.get(this).getScaledTouchSlop();
                touchSlop = slop;

                tvCurrent.setOnTouchListener(new View.OnTouchListener() {
                    @Override
                    public boolean onTouch(View v, MotionEvent ev) {
                        try {
                            if (ev.getAction() == MotionEvent.ACTION_DOWN) {
                                downX = (int) ev.getRawX();
                                downY = (int) ev.getRawY();
                                WindowManager.LayoutParams lp = (WindowManager.LayoutParams) v.getLayoutParams();
                                startX = lp.x;
                                startY = lp.y;
                                dragging = false;
                                return true;
                            }
                            if (ev.getAction() == MotionEvent.ACTION_MOVE) {
                                int dx = (int) ev.getRawX() - downX;
                                int dy = (int) ev.getRawY() - downY;
                                if (!dragging && (Math.abs(dx) > slop || Math.abs(dy) > slop)) {
                                    dragging = true;
                                }
                                if (dragging) {
                                    WindowManager.LayoutParams lp = (WindowManager.LayoutParams) v.getLayoutParams();
                                    lp.x = startX + dx;
                                    lp.y = startY + dy;
                                    if (wm != null && v.getWindowToken() != null) {
                                        wm.updateViewLayout(v, lp);
                                    }
                                }
                                return true;
                            }
                            if (ev.getAction() == MotionEvent.ACTION_UP
                                    || ev.getAction() == MotionEvent.ACTION_CANCEL) {
                                if (dragging) {
                                    WindowManager.LayoutParams lp = (WindowManager.LayoutParams) v.getLayoutParams();
                                    savePos(lp.x, lp.y);
                                }
                                dragging = false;
                                return true;
                            }
                        } catch (Throwable ignored) { }
                        return false;
                    }
                });

                WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                        WindowManager.LayoutParams.WRAP_CONTENT,
                        WindowManager.LayoutParams.WRAP_CONTENT,
                        overlayType(),
                        // 默认 FLAG_NOT_TOUCHABLE：歌词窗不接收任何触摸事件，
                        // 盖在别的应用上面也不会挡住人家点按钮。
                        // 用户在设置里打开「可拖动」后，才切成可触摸模式。
                        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                                | (touchable ? 0 : WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE)
                                | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
                        android.graphics.PixelFormat.TRANSLUCENT);

                params.gravity = Gravity.TOP | Gravity.START;
                params.x = savedX >= 0 ? savedX : dp(24);
                params.y = savedY >= 0 ? savedY : dp(120);

                wm.addView(root, params);
                attached = true;
                applyVisibility();
            } catch (Throwable t) {
                // 失败就彻底放弃这次挂载，不能带着半个状态继续跑
                try {
                    if (wm != null && root != null) wm.removeView(root);
                } catch (Throwable ignored) { }
                attached = false;
                root = null;
                tvCurrent = null;
            }
        }
    }

    /** 切换「可拖动」：可拖动 = 窗口可触摸；否则完全不接收触摸 */
    public void setTouchable(final boolean can) {
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                if (touchable == can) return;
                touchable = can;
                if (!attached || root == null || wm == null) return;
                try {
                    if (root.getWindowToken() == null) return;
                    WindowManager.LayoutParams lp = (WindowManager.LayoutParams) root.getLayoutParams();
                    if (can) {
                        lp.flags &= ~WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
                    } else {
                        lp.flags |= WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
                    }
                    wm.updateViewLayout(root, lp);
                } catch (Throwable ignored) { }
            }
        });
    }

    private void detach() {
        synchronized (lock) {
            if (!attached) {
                root = null;
                tvCurrent = null;
                return;
            }
            try {
                if (wm != null && root != null) wm.removeView(root);
            } catch (Throwable ignored) { }
            attached = false;
            root = null;
            tvCurrent = null;
        }
    }

    private int overlayType() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY;
        }
        return WindowManager.LayoutParams.TYPE_PHONE;
    }

    /** 软件在前台时隐藏，后台时显示 */
    private void applyVisibility() {
        if (!attached || root == null) return;
        try {
            if (root.getWindowToken() == null) return;
            if (appForeground) {
                if (root.getVisibility() == View.VISIBLE) root.setVisibility(View.GONE);
            } else if (root.getVisibility() != View.VISIBLE) {
                root.setVisibility(View.VISIBLE);
            }
        } catch (Throwable ignored) { }
    }

    /**
     * 更新歌词内容（只显示当前一句）。
     * 任何线程都能调用，内部统一切到主线程。
     */
    public void update(final String current) {
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                try {
                    if (!attached) attach();
                    if (!attached || tvCurrent == null) return;
                    tvCurrent.setText(current == null || current.length() == 0 ? "♪" : current);
                } catch (Throwable ignored) { }
            }
        });
    }

    /**
     * 设置歌词颜色与不透明度。
     * @param color 形如 "#RRGGBB"，传 null / 空表示保持不变
     * @param alpha 0~1，传负数表示保持不变
     */
    public void setStyle(final String color, final float alpha) {
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                try {
                    if (color != null && color.length() > 0) {
                        int c = parseColor(color);
                        if (c != -1) textColor = c;
                    }
                    if (alpha >= 0f && alpha <= 1f) textAlpha = alpha;
                    if (tvCurrent != null) {
                        tvCurrent.setTextColor(textColor);
                        applyTextAlpha();
                    }
                } catch (Throwable ignored) { }
            }
        });
    }

    private void applyTextAlpha() {
        if (tvCurrent == null) return;
        int a = (int) Math.max(0, Math.min(255, Math.round(255 * textAlpha)));
        tvCurrent.setAlpha(textAlpha);
        tvCurrent.setTextColor(Color.argb(a, Color.red(textColor), Color.green(textColor), Color.blue(textColor)));
    }

    /** 支持 #RGB / #RRGGBB / #AARRGGBB */
    static int parseColor(String s) {
        try {
            String v = s.trim();
            if (v.startsWith("#")) v = v.substring(1);
            if (v.length() == 3) {
                int r = Integer.parseInt(v.substring(0, 1), 16);
                int g = Integer.parseInt(v.substring(1, 2), 16);
                int b = Integer.parseInt(v.substring(2, 3), 16);
                return Color.rgb(r * 17, g * 17, b * 17);
            }
            if (v.length() == 6) return Color.parseColor("#" + v);
            if (v.length() == 8) return (int) Long.parseLong(v, 16);
        } catch (Throwable ignored) { }
        return -1;
    }

    /** 前台/后台切换时由 Activity 调用 */
    public void setAppForeground(final boolean fg) {
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                appForeground = fg;
                if (!attached) {
                    if (fg) return;
                    attach();
                    return;
                }
                applyVisibility();
            }
        });
    }

    /** Activity 转发用 */
    public static void notifyForeground(Activity act, boolean fg) {
        try {
            LyricsService s = instance;
            if (s != null) s.setAppForeground(fg);
        } catch (Throwable ignored) { }
    }

    private int dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density + 0.5f);
    }
}
