package com.bmfreemusic.app;

import android.content.Context;
import android.content.res.AssetManager;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;
import java.security.cert.X509Certificate;

/**
 * LocalServer —— 应用内置的迷你 HTTP 服务器
 *
 * Android 上没有 Node，所以把 server/index.js 的能力用 Java 重写一遍：
 *   · 静态资源：从 APK 的 assets 读取（WebView 直接访问 127.0.0.1 即可）
 *   · /api/raw     转发任意上游请求（可带 referer / cookie）
 *   · /api/stream  音频流转发，支持 Range
 *   · /api/img     图片转发
 *   · /api/aggr/*  第三方聚合音乐站适配
 *
 * 这样前端代码一行都不用改，和桌面版共用同一套 UI 与逻辑。
 */
public class LocalServer {

    /**
     * 端口必须固定！
     *
     * WebView 的 localStorage 是按 origin（http://127.0.0.1:端口）隔离的，
     * 每次启动换端口等于换了一个新站点，之前存的数据全部读不到 ——
     * 表现就是「重启后账号和歌单都没了」。
     */
    private static final int DEFAULT_PORT = 18321;
    private static final int PORT_TRIES = 10;

    private final Context ctx;
    private ServerSocket server;
    private ExecutorService pool;
    private volatile boolean running = true;
    private int port;

    public LocalServer(Context c) {
        this.ctx = c;
        installRelaxedSSL();
    }

    public int start() throws IOException {
        IOException last = null;
        for (int i = 0; i < PORT_TRIES; i++) {
            int tryPort = DEFAULT_PORT + i;
            try {
                server = new ServerSocket(tryPort, 64, InetAddress.getByName("127.0.0.1"));
                server.setReuseAddress(true);
                port = tryPort;
                break;
            } catch (IOException e) {
                last = e;
            }
        }
        if (server == null) throw last != null ? last : new IOException("无法绑定本地端口");

        pool = Executors.newFixedThreadPool(16);
        Thread t = new Thread(new Runnable() {
            @Override
            public void run() {
                acceptLoop();
            }
        }, "bmfm-http");
        t.setDaemon(true);
        t.start();
        return port;
    }

    public void stop() {
        running = false;
        try { if (server != null) server.close(); } catch (IOException ignored) { }
        if (pool != null) pool.shutdownNow();
    }

    private void acceptLoop() {
        while (running) {
            try {
                final Socket s = server.accept();
                pool.submit(new Runnable() {
                    @Override
                    public void run() {
                        handle(s);
                    }
                });
            } catch (IOException e) {
                if (!running) return;
            }
        }
    }

    private void handle(Socket socket) {
        try {
            socket.setSoTimeout(45000);
            InputStream in = new BufferedInputStream(socket.getInputStream(), 16384);
            OutputStream out = new BufferedOutputStream(socket.getOutputStream(), 16384);

            Request req = Request.parse(in);
            if (req == null) { socket.close(); return; }

            try {
                route(req, out);
                out.flush();
            } finally {
                try { socket.close(); } catch (IOException ignored) { }
            }
        } catch (Exception e) {
            try { socket.close(); } catch (IOException ignored) { }
        }
    }

    /* ======================================================================
       路由
       ====================================================================== */
    private void route(Request req, OutputStream out) throws IOException {
        String path = req.path;

        if (path.equals("/api/health")) {
            writeJson(out, 200, "{\"ok\":true,\"app\":\"BM Free Music\",\"version\":\"1.0.0\",\"runtime\":\"android\"}");
            return;
        }
        if (path.equals("/api/raw")) { handleRaw(req, out); return; }
        if (path.equals("/api/stream")) { handleStream(req, out); return; }
        if (path.equals("/api/img")) { handleImage(req, out); return; }
        if (path.equals("/api/aggr/sites")) {
            writeJson(out, 200, "{\"ok\":true,\"sites\":" + Aggregator.sitesJson() + "}");
            return;
        }
        if (path.equals("/api/aggr/search")) { handleAggrSearch(req, out); return; }
        if (path.equals("/api/aggr/play")) { handleAggrPlay(req, out); return; }
        if (path.startsWith("/api/")) {
            writeJson(out, 404, "{\"ok\":false,\"error\":\"unknown endpoint\"}");
            return;
        }
        serveAsset(path, out);
    }

    /* ======================================================================
       /api/raw
       ====================================================================== */
    private void handleRaw(Request req, OutputStream out) throws IOException {
        String bodyStr = req.body == null ? "" : new String(req.body, "UTF-8");
        Map<String, String> p = Json.parseObject(bodyStr);
        if (p == null) {
            writeJson(out, 400, "{\"ok\":false,\"error\":\"请求体必须是 JSON\"}");
            return;
        }
        String url = p.get("url");
        if (url == null || url.isEmpty()) {
            writeJson(out, 400, "{\"ok\":false,\"error\":\"缺少 url\"}");
            return;
        }
        if (!Proxy.isSafeTarget(url)) {
            writeJson(out, 400, "{\"ok\":false,\"error\":\"目标地址不被允许\"}");
            return;
        }

        try {
            Proxy.Result r = Proxy.fetch(url,
                    p.get("referer"), p.get("cookie"),
                    p.getOrDefault("method", "GET"),
                    p.get("body"), null);
            Map<String, String> h = new HashMap<>();
            h.put("content-type", r.contentType == null ? "text/plain; charset=utf-8" : r.contentType);
            writeResponse(out, r.status, h, r.body);
        } catch (Exception e) {
            writeJson(out, 502, "{\"ok\":false,\"error\":\"上游请求失败: " + Json.esc(e.getMessage()) + "\"}");
        }
    }

    /* ======================================================================
       /api/stream —— 音频流
       ====================================================================== */
    private void handleStream(Request req, OutputStream out) throws IOException {
        String target = req.query.get("u");
        String referer = req.query.getOrDefault("ref", "");
        if (target == null) { writeText(out, 400, "missing u"); return; }
        if (!Proxy.isSafeTarget(target)) { writeText(out, 400, "blocked"); return; }

        String range = req.header("range");
        try {
            Proxy.StreamResult sr = Proxy.openStream(target, referer, range);
            StringBuilder sb = new StringBuilder();
            sb.append("HTTP/1.1 ").append(sr.status).append(' ').append(statusText(sr.status)).append("\r\n");
            sb.append("Content-Type: ").append(sr.contentType == null ? "audio/mpeg" : sr.contentType).append("\r\n");
            sb.append("Accept-Ranges: bytes\r\n");
            sb.append("Access-Control-Allow-Origin: *\r\n");
            sb.append("Cross-Origin-Resource-Policy: cross-origin\r\n");
            sb.append("Cache-Control: no-store\r\n");
            if (sr.contentRange != null) sb.append("Content-Range: ").append(sr.contentRange).append("\r\n");
            if (sr.contentLength > 0) sb.append("Content-Length: ").append(sr.contentLength).append("\r\n");
            sb.append("Connection: close\r\n\r\n");
            out.write(sb.toString().getBytes("UTF-8"));

            InputStream in = sr.stream;
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                out.flush();
            }
            try { in.close(); } catch (IOException ignored) { }
        } catch (Exception e) {
            try { writeText(out, 502, "stream failed: " + e.getMessage()); } catch (IOException ignored) { }
        }
    }

    /* ======================================================================
       /api/img
       ====================================================================== */
    private void handleImage(Request req, OutputStream out) throws IOException {
        String target = req.query.get("u");
        String referer = req.query.getOrDefault("ref", "");
        if (target == null) { writeText(out, 400, "missing u"); return; }
        if (!Proxy.isSafeTarget(target)) { writeText(out, 400, "blocked"); return; }

        try {
            Proxy.Result r = Proxy.fetch(target, referer, null, "GET", null, null);
            Map<String, String> h = new HashMap<>();
            h.put("content-type", r.contentType == null ? "image/jpeg" : r.contentType);
            h.put("cache-control", "public, max-age=86400");
            writeResponse(out, r.status == 0 ? 200 : r.status, h, r.body);
        } catch (Exception e) {
            writeText(out, 502, "image failed");
        }
    }

    /* ======================================================================
       聚合站
       ====================================================================== */
    private void handleAggrSearch(Request req, OutputStream out) throws IOException {
        String site = req.query.get("site");
        String kw = req.query.get("kw");
        int limit = 30;
        try {
            if (req.query.containsKey("limit")) limit = Integer.parseInt(req.query.get("limit"));
        } catch (NumberFormatException ignored) { }
        if (site == null || kw == null) {
            writeJson(out, 400, "{\"ok\":false,\"error\":\"缺少 site 或 kw\"}");
            return;
        }
        try {
            String json = Aggregator.search(site, kw, limit);
            writeJson(out, 200, json);
        } catch (Exception e) {
            writeJson(out, 502, "{\"ok\":false,\"site\":\"" + Json.esc(site)
                    + "\",\"error\":\"" + Json.esc(e.getMessage()) + "\"}");
        }
    }

    private void handleAggrPlay(Request req, OutputStream out) throws IOException {
        String site = req.query.get("site");
        String id = req.query.get("id");
        if (site == null || id == null) {
            writeJson(out, 400, "{\"ok\":false,\"error\":\"缺少 site 或 id\"}");
            return;
        }
        try {
            String json = Aggregator.resolve(site, id);
            writeJson(out, 200, json);
        } catch (Exception e) {
            writeJson(out, 502, "{\"ok\":false,\"site\":\"" + Json.esc(site)
                    + "\",\"error\":\"" + Json.esc(e.getMessage()) + "\"}");
        }
    }

    /* ======================================================================
       静态资源
       ====================================================================== */
    private void serveAsset(String path, OutputStream out) throws IOException {
        String rel = path;
        if (rel.equals("/") || rel.isEmpty()) rel = "/index.html";
        if (rel.startsWith("/")) rel = rel.substring(1);
        rel = rel.replace("..", "");

        AssetManager am = ctx.getAssets();
        InputStream in = null;
        try {
            in = am.open(rel);
        } catch (IOException e) {
            // SPA 兜底
            if (!rel.contains(".")) {
                try { in = am.open("index.html"); } catch (IOException ignored) { }
            }
            if (in == null) {
                writeText(out, 404, "not found: " + rel);
                return;
            }
        }

        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
        in.close();

        Map<String, String> h = new HashMap<>();
        h.put("content-type", mimeOf(rel));
        h.put("cache-control", rel.endsWith(".html") ? "no-cache" : "public, max-age=3600");
        writeResponse(out, 200, h, bos.toByteArray());
    }

    private static String mimeOf(String path) {
        String p = path.toLowerCase(Locale.ROOT);
        if (p.endsWith(".html")) return "text/html; charset=utf-8";
        if (p.endsWith(".css")) return "text/css; charset=utf-8";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript; charset=utf-8";
        if (p.endsWith(".json") || p.endsWith(".webmanifest")) return "application/json; charset=utf-8";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".mp3")) return "audio/mpeg";
        return "application/octet-stream";
    }

    /* ======================================================================
       响应写出
       ====================================================================== */
    private static String statusText(int code) {
        switch (code) {
            case 200: return "OK";
            case 206: return "Partial Content";
            case 301: return "Moved Permanently";
            case 302: return "Found";
            case 304: return "Not Modified";
            case 400: return "Bad Request";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 429: return "Too Many Requests";
            case 500: return "Internal Server Error";
            case 502: return "Bad Gateway";
            default: return "OK";
        }
    }

    private static void writeResponse(OutputStream out, int status, Map<String, String> headers, byte[] body)
            throws IOException {
        StringBuilder sb = new StringBuilder();
        sb.append("HTTP/1.1 ").append(status).append(' ').append(statusText(status)).append("\r\n");
        for (Map.Entry<String, String> e : headers.entrySet()) {
            sb.append(e.getKey()).append(": ").append(e.getValue()).append("\r\n");
        }
        sb.append("Content-Length: ").append(body == null ? 0 : body.length).append("\r\n");
        sb.append("Access-Control-Allow-Origin: *\r\n");
        sb.append("Connection: close\r\n\r\n");
        out.write(sb.toString().getBytes("UTF-8"));
        if (body != null && body.length > 0) out.write(body);
    }

    private static void writeJson(OutputStream out, int status, String json) throws IOException {
        Map<String, String> h = new HashMap<>();
        h.put("content-type", "application/json; charset=utf-8");
        h.put("cache-control", "no-store");
        writeResponse(out, status, h, json.getBytes("UTF-8"));
    }

    private static void writeText(OutputStream out, int status, String text) throws IOException {
        Map<String, String> h = new HashMap<>();
        h.put("content-type", "text/plain; charset=utf-8");
        writeResponse(out, status, h, text.getBytes("UTF-8"));
    }

    /* ======================================================================
       宽松 TLS（部分音乐站证书链不完整）
       ====================================================================== */
    private static void installRelaxedSSL() {
        try {
            TrustManager[] trustAll = new TrustManager[]{
                    new X509TrustManager() {
                        public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
                        public void checkClientTrusted(X509Certificate[] c, String a) { }
                        public void checkServerTrusted(X509Certificate[] c, String a) { }
                    }
            };
            SSLContext sc = SSLContext.getInstance("TLS");
            sc.init(null, trustAll, new java.security.SecureRandom());
            HttpsURLConnection.setDefaultSSLSocketFactory(sc.getSocketFactory());
            HttpsURLConnection.setDefaultHostnameVerifier(new javax.net.ssl.HostnameVerifier() {
                @Override
                public boolean verify(String hostname, javax.net.ssl.SSLSession session) {
                    return true;
                }
            });
        } catch (Exception ignored) { }
    }

    /* ======================================================================
       请求对象
       ====================================================================== */
    static class Request {
        String method;
        String path;
        String rawQuery = "";
        Map<String, String> query = new HashMap<>();
        Map<String, String> headers = new HashMap<>();
        byte[] body;

        String header(String name) {
            return headers.get(name.toLowerCase(Locale.ROOT));
        }

        static Request parse(InputStream in) throws IOException {
            Request r = new Request();
            String line = readLine(in);
            if (line == null || line.isEmpty()) return null;

            String[] parts = line.split(" ");
            if (parts.length < 2) return null;
            r.method = parts[0].toUpperCase(Locale.ROOT);
            String full = parts[1];

            int q = full.indexOf('?');
            if (q >= 0) {
                r.path = full.substring(0, q);
                r.rawQuery = full.substring(q + 1);
                r.query = parseQuery(r.rawQuery);
            } else {
                r.path = full;
            }

            String h;
            while ((h = readLine(in)) != null && !h.isEmpty()) {
                int c = h.indexOf(':');
                if (c > 0) {
                    r.headers.put(h.substring(0, c).trim().toLowerCase(Locale.ROOT), h.substring(c + 1).trim());
                }
            }

            String cl = r.headers.get("content-length");
            if (cl != null) {
                int len;
                try { len = Integer.parseInt(cl.trim()); } catch (NumberFormatException e) { len = 0; }
                if (len > 0 && len < 8 * 1024 * 1024) {
                    byte[] buf = new byte[len];
                    int off = 0;
                    while (off < len) {
                        int n = in.read(buf, off, len - off);
                        if (n < 0) break;
                        off += n;
                    }
                    r.body = buf;
                }
            }
            return r;
        }

        private static String readLine(InputStream in) throws IOException {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            int c;
            boolean any = false;
            while ((c = in.read()) != -1) {
                any = true;
                if (c == '\n') break;
                if (c != '\r') bos.write(c);
            }
            if (!any) return null;
            return new String(bos.toByteArray(), "UTF-8");
        }

        static Map<String, String> parseQuery(String q) {
            Map<String, String> map = new HashMap<>();
            if (q == null || q.isEmpty()) return map;
            for (String pair : q.split("&")) {
                if (pair.isEmpty()) continue;
                int eq = pair.indexOf('=');
                try {
                    if (eq < 0) {
                        map.put(Proxy.urlDecode(pair), "");
                    } else {
                        map.put(Proxy.urlDecode(pair.substring(0, eq)), Proxy.urlDecode(pair.substring(eq + 1)));
                    }
                } catch (Exception ignored) { }
            }
            return map;
        }
    }
}
