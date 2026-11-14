package com.bmfreemusic.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.IBinder;

import org.json.JSONObject;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;

/**
 * PlaybackService —— 通知栏播放控制
 *
 * 用系统原生 MediaSession（不是 androidx，因为项目不跑 Gradle）：
 *   · 通知栏显示封面、歌名、歌手
 *   · 三个按钮：上一首 / 播放暂停 / 下一首
 *   · 锁屏和耳机线控的媒体键也会走 MediaSession 回调
 *
 * 状态由 WebView 里的 player 推过来，按钮点击再推回 WebView。
 */
public class PlaybackService extends Service {

    public interface Bridge {
        void onCommand(String action);   // play | pause | toggle | next | prev
    }

    public static PlaybackService instance;
    /** MainActivity 启动时挂上来，服务被动转发命令用 */
    public static Bridge bridge;

    private static final String CHANNEL_ID = "bmfm_playback";
    private static final int NOTIF_ID = 1001;

    private static final String ACTION_PREV = "com.bmfreemusic.app.PREV";
    private static final String ACTION_TOGGLE = "com.bmfreemusic.app.TOGGLE";
    private static final String ACTION_NEXT = "com.bmfreemusic.app.NEXT";

    private MediaSession mediaSession;
    private NotificationManager nm;

    private String title = "";
    private String artist = "";
    private String album = "";
    private String coverUrl = "";
    private boolean playing = false;
    private long duration = 0;
    private long position = 0;

    private final Map<String, Bitmap> coverCache = new HashMap<>();
    private String lastCoverKey = "";

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        createChannel();
        setupSession();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID, "正在播放", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("显示当前播放的歌曲并提供控制按钮");
            ch.setShowBadge(false);
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(ch);
        }
    }

    private void setupSession() {
        mediaSession = new MediaSession(this, "BMFreeMusic");
        mediaSession.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS |
                MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
        mediaSession.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { fire("play"); }
            @Override public void onPause() { fire("pause"); }
            @Override public void onSkipToNext() { fire("next"); }
            @Override public void onSkipToPrevious() { fire("prev"); }
            @Override public void onStop() { fire("pause"); }
        });
        mediaSession.setActive(true);
    }

    private void fire(String action) {
        if (bridge != null) {
            try { bridge.onCommand(action); } catch (Exception ignored) { }
        }
    }

    /* ======================================================================
       由 WebView 推送状态
       ====================================================================== */
    public void updateFromJson(String json) {
        try {
            JSONObject o = new JSONObject(json);
            title = o.optString("title", "");
            artist = o.optString("artist", "");
            album = o.optString("album", "");
            coverUrl = o.optString("cover", "");
            playing = o.optBoolean("playing", false);
            duration = o.optLong("duration", 0);
            position = o.optLong("position", 0);
            render();
        } catch (Exception ignored) { }
    }

    public void clearNotification() {
        try { nm.cancel(NOTIF_ID); } catch (Exception ignored) { }
        try { mediaSession.setActive(false); } catch (Exception ignored) { }
    }

    /* ======================================================================
       渲染
       ====================================================================== */
    private void render() {
        if (title == null || title.isEmpty()) {
            clearNotification();
            return;
        }

        updateMetadata();
        Bitmap cover = coverUrl.isEmpty() ? null : getCover(coverUrl);

        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);

        b.setSmallIcon(R.drawable.ic_stat_music)
                .setContentTitle(title)
                .setContentText(artist)
                .setSubText(album.isEmpty() ? null : album)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setContentIntent(openAppIntent());

        if (cover != null) b.setLargeIcon(cover);

        // 三个控制按钮
        b.addAction(new Notification.Action.Builder(
                android.graphics.drawable.Icon.createWithResource(this, android.R.drawable.ic_media_previous),
                "上一首", serviceIntent(ACTION_PREV)).build());
        b.addAction(new Notification.Action.Builder(
                android.graphics.drawable.Icon.createWithResource(this,
                        playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play),
                playing ? "暂停" : "播放", serviceIntent(ACTION_TOGGLE)).build());
        b.addAction(new Notification.Action.Builder(
                android.graphics.drawable.Icon.createWithResource(this, android.R.drawable.ic_media_next),
                "下一首", serviceIntent(ACTION_NEXT)).build());

        Notification.MediaStyle style = new Notification.MediaStyle()
                .setMediaSession(mediaSession.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2);
        b.setStyle(style);

        Notification n = b.build();
        n.flags |= Notification.FLAG_ONGOING_EVENT;

        try {
            startForeground(NOTIF_ID, n);
        } catch (Exception e) {
            try { nm.notify(NOTIF_ID, n); } catch (Exception ignored) { }
        }
    }

    private void updateMetadata() {
        try {
            MediaMetadata.Builder md = new MediaMetadata.Builder()
                    .putString(MediaMetadata.METADATA_KEY_TITLE, title)
                    .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
                    .putString(MediaMetadata.METADATA_KEY_ALBUM, album)
                    .putLong(MediaMetadata.METADATA_KEY_DURATION, duration);
            mediaSession.setMetadata(md.build());

            long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE |
                    PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_SKIP_TO_NEXT |
                    PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_STOP;

            PlaybackState pb = new PlaybackState.Builder()
                    .setActions(actions)
                    .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                            position, 1.0f)
                    .build();
            mediaSession.setPlaybackState(pb);
        } catch (Exception ignored) { }
    }

    private PendingIntent openAppIntent() {
        Intent i = new Intent(this, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(this, 0, i, flags);
    }

    private PendingIntent serviceIntent(String action) {
        Intent i = new Intent(this, PlaybackService.class).setAction(action);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getService(this, action.hashCode(), i, flags);
    }

    /* ---------------- 封面（异步下载 + 内存缓存） ---------------- */
    private Bitmap getCover(final String url) {
        if (url.equals(lastCoverKey) && coverCache.containsKey(url)) return coverCache.get(url);

        Bitmap cached = coverCache.get(url);
        if (cached != null) return cached;

        lastCoverKey = url;
        new Thread(new Runnable() {
            @Override
            public void run() {
                Bitmap bmp = download(url);
                if (bmp != null) {
                    if (coverCache.size() > 12) coverCache.clear();
                    coverCache.put(url, bmp);
                    // 封面到位后重绘一次
                    android.os.Handler h = new android.os.Handler(getMainLooper());
                    h.post(new Runnable() {
                        @Override public void run() { render(); }
                    });
                }
            }
        }).start();
        return null;
    }

    private Bitmap download(String u) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(u);
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);
            conn.setRequestProperty("User-Agent", Proxy.UA);
            conn.setInstanceFollowRedirects(true);
            InputStream in = conn.getInputStream();
            Bitmap bmp = BitmapFactory.decodeStream(in);
            in.close();
            return bmp;
        } catch (Exception e) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    /* ---------------- Service 生命周期 ---------------- */
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && intent.getAction() != null) {
            String a = intent.getAction();
            if (ACTION_PREV.equals(a)) fire("prev");
            else if (ACTION_NEXT.equals(a)) fire("next");
            else if (ACTION_TOGGLE.equals(a)) fire("toggle");
        }

        // startForegroundService 要求 5 秒内必须 startForeground，否则 ANR。
        // 还没歌时先挂一个极简占位，10 秒后仍然没歌就自己退场。
        if (title == null || title.isEmpty()) {
            try {
                startForeground(NOTIF_ID, idleNotification());
            } catch (Exception ignored) { }
            new android.os.Handler(getMainLooper()).postDelayed(new Runnable() {
                @Override
                public void run() {
                    if (title == null || title.isEmpty()) {
                        try { stopForeground(true); } catch (Exception ignored) { }
                        stopSelf();
                    }
                }
            }, 10000);
        }

        return START_STICKY;
    }

    private Notification idleNotification() {
        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);
        b.setSmallIcon(R.drawable.ic_stat_music)
                .setContentTitle("BM Free Music")
                .setContentText("准备播放")
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setContentIntent(openAppIntent());
        return b.build();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        instance = null;
        try {
            if (mediaSession != null) {
                mediaSession.setActive(false);
                mediaSession.release();
            }
        } catch (Exception ignored) { }
        super.onDestroy();
    }
}
