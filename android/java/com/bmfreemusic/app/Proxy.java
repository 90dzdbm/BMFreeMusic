package com.bmfreemusic.app;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.util.Locale;
import java.util.zip.GZIPInputStream;

/**
 * Proxy —— 上游 HTTP 转发与安全校验
 */
public final class Proxy {

    public static final String UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

    private Proxy() { }

    /* ---------------- URL 编解码 ---------------- */
    public static String urlDecode(String s) {
        try { return URLDecoder.decode(s, "UTF-8"); } catch (Exception e) { return s; }
    }

    public static String urlEncode(String s) {
        try { return URLEncoder.encode(s == null ? "" : s, "UTF-8"); } catch (Exception e) { return s; }
    }

    /* ---------------- 安全校验：禁止内网 ---------------- */
    public static boolean isSafeTarget(String raw) {
        try {
            URL u = new URL(raw);
            String proto = u.getProtocol().toLowerCase(Locale.ROOT);
            if (!proto.equals("http") && !proto.equals("https")) return false;
            String host = u.getHost().toLowerCase(Locale.ROOT);
            if (host.isEmpty()) return false;
            if (host.equals("localhost") || host.equals("::1") || host.endsWith(".local")) return false;
            if (host.startsWith("127.") || host.startsWith("0.") || host.startsWith("10.")) return false;
            if (host.startsWith("192.168.") || host.startsWith("169.254.")) return false;
            if (host.startsWith("172.")) {
                String[] p = host.split("\\.");
                if (p.length > 1) {
                    int second = Integer.parseInt(p[1]);
                    if (second >= 16 && second <= 31) return false;
                }
            }
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /* ---------------- 普通请求 ---------------- */
    public static class Result {
        public int status;
        public String contentType;
        public byte[] body;
    }

    public static Result fetch(String url, String referer, String cookie,
                               String method, String postBody, String[] extraPairs) throws IOException {
        HttpURLConnection conn = open(url, referer, cookie, method, postBody, extraPairs);

        Result r = new Result();
        // 注意：contentType 必须在 disconnect 之前读取，否则拿到的可能是 null
        r.status = conn.getResponseCode();
        r.contentType = conn.getContentType();
        String enc = conn.getContentEncoding();

        InputStream is = r.status >= 400 ? conn.getErrorStream() : conn.getInputStream();
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        if (is != null) {
            InputStream src = is;
            if (enc != null && enc.toLowerCase(Locale.ROOT).contains("gzip")) {
                try { src = new GZIPInputStream(is); } catch (IOException e) { src = is; }
            }
            byte[] buf = new byte[16384];
            int n;
            while ((n = src.read(buf)) > 0) bos.write(buf, 0, n);
            src.close();
        }
        conn.disconnect();

        r.body = bos.toByteArray();
        return r;
    }

    /* ---------------- 流式请求（音频） ---------------- */
    public static class StreamResult {
        public int status;
        public String contentType;
        public long contentLength;
        public String contentRange;
        public InputStream stream;
    }

    public static StreamResult openStream(String url, String referer, String range) throws IOException {
        HttpURLConnection conn = open(url, referer, null, "GET", null, null);
        if (range != null && !range.isEmpty()) {
            conn.setRequestProperty("Range", range);
        }
        int status = conn.getResponseCode();
        if (status >= 400) {
            InputStream err = conn.getErrorStream();
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            if (err != null) {
                byte[] b = new byte[4096];
                int n;
                while ((n = err.read(b)) > 0) bos.write(b, 0, n);
                err.close();
            }
            conn.disconnect();
            throw new IOException("upstream " + status + " " + bos.toString("UTF-8"));
        }

        StreamResult sr = new StreamResult();
        sr.status = status;
        sr.contentType = conn.getContentType();
        sr.contentLength = conn.getContentLengthLong();
        sr.contentRange = conn.getHeaderField("Content-Range");
        sr.stream = conn.getInputStream();
        return sr;
    }

    /* ---------------- 底层连接 ---------------- */
    private static HttpURLConnection open(String url, String referer, String cookie,
                                          String method, String postBody, String[] extraPairs)
            throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setRequestMethod(method == null || method.isEmpty() ? "GET" : method.toUpperCase(Locale.ROOT));
        conn.setInstanceFollowRedirects(true);
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(25000);
        conn.setRequestProperty("User-Agent", UA);
        conn.setRequestProperty("Accept", "*/*");
        conn.setRequestProperty("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8");
        if (referer != null && !referer.isEmpty()) conn.setRequestProperty("Referer", referer);
        if (cookie != null && !cookie.isEmpty()) conn.setRequestProperty("Cookie", cookie);
        if (extraPairs != null) {
            for (int i = 0; i + 1 < extraPairs.length; i += 2) {
                if (extraPairs[i] != null && extraPairs[i + 1] != null) {
                    conn.setRequestProperty(extraPairs[i], extraPairs[i + 1]);
                }
            }
        }

        if (postBody != null && !postBody.isEmpty()) {
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
            byte[] data = postBody.getBytes("UTF-8");
            conn.setFixedLengthStreamingMode(data.length);
            OutputStream os = conn.getOutputStream();
            os.write(data);
            os.flush();
            os.close();
        }
        return conn;
    }
}
