package com.bmfreemusic.app;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.GZIPInputStream;

/**
 * Aggregator —— 第三方聚合音乐站（歌曲宝 / 下歌宝 / 歌曲海）
 *
 * 这些站点把各平台的音频转存了一遍，所以主音源放不了的会员曲目，
 * 在这里通常能拿到直链。它们的共同套路是「详情页发一次性 play_id + Session，
 * 再 POST 取址接口」，因此必须用 Cookie Jar 保持同一会话。
 */
public final class Aggregator {

    private Aggregator() { }

    private static final String UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

    /* ---------------- 站点表 ---------------- */
    private static final Map<String, String> SITES = new LinkedHashMap<>();
    static {
        SITES.put("gequbao", "https://www.gequbao.com");
        SITES.put("xiagebao", "https://www.xiagebao.com");
        SITES.put("gequhai", "https://www.gequhai.com");
    }

    public static String sitesJson() {
        StringBuilder sb = new StringBuilder("[");
        boolean first = true;
        for (Map.Entry<String, String> e : SITES.entrySet()) {
            if (!first) sb.append(',');
            first = false;
            sb.append("{\"key\":\"").append(e.getKey())
              .append("\",\"base\":\"").append(e.getValue())
              .append("\",\"name\":\"").append(e.getValue().replace("https://", ""))
              .append("\"}");
        }
        return sb.append(']').toString();
    }

    /* ---------------- Cookie Jar ---------------- */
    private static final Map<String, Map<String, String>> JARS = new HashMap<>();

    private static String hostOf(String url) {
        try { return new URL(url).getHost(); } catch (Exception e) { return "unknown"; }
    }

    private static void absorb(String url, HttpURLConnection conn) {
        String host = hostOf(url);
        Map<String, String> jar = JARS.get(host);
        if (jar == null) { jar = new HashMap<>(); JARS.put(host, jar); }
        for (int i = 0; ; i++) {
            String raw = conn.getHeaderField("Set-Cookie" + (i == 0 ? "" : String.valueOf(i)));
            if (raw == null) break;
            String pair = raw.split(";")[0];
            int eq = pair.indexOf('=');
            if (eq > 0) jar.put(pair.substring(0, eq).trim(), pair.substring(eq + 1).trim());
        }
    }

    private static String cookieOf(String url) {
        Map<String, String> jar = JARS.get(hostOf(url));
        if (jar == null || jar.isEmpty()) return "";
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<String, String> e : jar.entrySet()) {
            if (sb.length() > 0) sb.append("; ");
            sb.append(e.getKey()).append('=').append(e.getValue());
        }
        return sb.toString();
    }

    /* ---------------- 请求 ---------------- */
    private static class Resp {
        int status;
        String text;
        String contentType;
    }

    private static Resp request(String url, String method, String body, String referer,
                                String[] extraHeaders) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setRequestMethod(method);
        conn.setInstanceFollowRedirects(true);
        conn.setConnectTimeout(12000);
        conn.setReadTimeout(18000);
        conn.setRequestProperty("User-Agent", UA);
        conn.setRequestProperty("Accept", "text/html,application/json,*/*");
        conn.setRequestProperty("Accept-Language", "zh-CN,zh;q=0.9");
        if (referer != null && !referer.isEmpty()) conn.setRequestProperty("Referer", referer);
        String ck = cookieOf(url);
        if (!ck.isEmpty()) conn.setRequestProperty("Cookie", ck);
        if (extraHeaders != null) {
            for (int i = 0; i + 1 < extraHeaders.length; i += 2) {
                if (extraHeaders[i] != null && extraHeaders[i + 1] != null) {
                    conn.setRequestProperty(extraHeaders[i], extraHeaders[i + 1]);
                }
            }
        }
        if (body != null) {
            conn.setDoOutput(true);
            if (conn.getRequestProperty("Content-Type") == null) {
                conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
            }
            byte[] data = body.getBytes("UTF-8");
            conn.setFixedLengthStreamingMode(data.length);
            OutputStream os = conn.getOutputStream();
            os.write(data);
            os.flush();
            os.close();
        }

        Resp r = new Resp();
        r.status = conn.getResponseCode();
        absorb(url, conn);
        r.contentType = conn.getContentType();
        InputStream is = r.status >= 400 ? conn.getErrorStream() : conn.getInputStream();
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        if (is != null) {
            String enc = conn.getContentEncoding();
            InputStream src = (enc != null && enc.toLowerCase(Locale.ROOT).contains("gzip"))
                    ? new GZIPInputStream(is) : is;
            byte[] buf = new byte[16384];
            int n;
            while ((n = src.read(buf)) > 0) bos.write(buf, 0, n);
            src.close();
        }
        conn.disconnect();
        r.text = new String(bos.toByteArray(), "UTF-8");
        return r;
    }

    /* ---------------- 工具 ---------------- */
    private static String stripTags(String s) {
        if (s == null) return "";
        String t = s.replaceAll("<[^>]*>", "")
                .replace("&nbsp;", " ")
                .replace("&amp;", "&")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&quot;", "\"")
                .replace("&#39;", "'")
                .replaceAll("\\s+", " ")
                .trim();
        return t;
    }

    private static String[] splitTitle(String title) {
        String t = stripTags(title);
        int idx = t.lastIndexOf(" - ");
        if (idx > 0) return new String[]{cleanName(t.substring(0, idx)), t.substring(idx + 3).trim()};
        int idx2 = t.lastIndexOf("－");
        if (idx2 > 0) return new String[]{cleanName(t.substring(0, idx2)), t.substring(idx2 + 1).trim()};
        return new String[]{cleanName(t), "未知歌手"};
    }

    /** 去掉聚合站标题里常见的前置编号，如 "160502河北墨麒麟" */
    private static String cleanName(String name) {
        if (name == null) return "";
        String t = name.replaceAll("^\\d{5,}\\s*(?=[\\u4e00-\\u9fa5])", "");
        return t.replaceAll("\\s+", " ").trim();
    }

    private static int parseDuration(String str) {
        if (str == null) return 0;
        Matcher m = Pattern.compile("^(\\d{1,2}):(\\d{2})$").matcher(str.trim());
        if (!m.find()) return 0;
        return (Integer.parseInt(m.group(1)) * 60 + Integer.parseInt(m.group(2))) * 1000;
    }

    /* ======================================================================
       搜索
       ====================================================================== */
    public static String search(String site, String keyword, int limit) throws IOException {
        String base = SITES.get(site);
        if (base == null) throw new IOException("未知聚合站 " + site);

        List<String[]> items;
        if (site.equals("gequhai")) {
            items = searchGequhai(base, keyword, limit);
        } else {
            items = searchLaravel(base, keyword, limit);
        }

        StringBuilder sb = new StringBuilder();
        sb.append("{\"ok\":true,\"site\":\"").append(Json.esc(site)).append("\",\"list\":[");
        for (int i = 0; i < items.size(); i++) {
            if (i > 0) sb.append(',');
            String[] it = items.get(i);
            sb.append("{\"id\":\"").append(Json.esc(it[0]))
              .append("\",\"name\":\"").append(Json.esc(it[1]))
              .append("\",\"artist\":\"").append(Json.esc(it[2]))
              .append("\",\"album\":\"\",\"duration\":").append(it.length > 3 ? it[3] : "0")
              .append(",\"cover\":\"\"}");
        }
        sb.append("]}");
        return sb.toString();
    }

    private static List<String[]> searchLaravel(String base, String keyword, int limit) throws IOException {
        String url = base + "/s/" + Proxy.urlEncode(keyword).replace("+", "%20");
        Resp r = request(url, "GET", null, base + "/", null);
        if (r.status != 200) throw new IOException("搜索页返回 " + r.status);

        List<String[]> out = new ArrayList<>();
        Matcher m = Pattern.compile("href=\"/music/(\\d+)\"[^>]*title=\"([^\"]*)\"").matcher(r.text);
        java.util.HashSet<String> seen = new java.util.HashSet<>();
        while (m.find() && out.size() < limit) {
            String id = m.group(1);
            if (!seen.add(id)) continue;
            String[] pair = splitTitle(m.group(2));
            if (pair[0].isEmpty()) continue;
            out.add(new String[]{id, pair[0], pair[1], "0"});
        }
        return out;
    }

    private static List<String[]> searchGequhai(String base, String keyword, int limit) throws IOException {
        String url = base + "/search?s=" + Proxy.urlEncode(keyword).replace("+", "%20");
        Resp r = request(url, "GET", null, base + "/", null);
        if (r.status != 200) throw new IOException("搜索页返回 " + r.status);

        List<String[]> out = new ArrayList<>();
        Pattern p = Pattern.compile(
                "<a[^>]+href=\"/play/(\\d+)\"[^>]*>([\\s\\S]*?)</a>\\s*</td>\\s*<td[^>]*>([\\s\\S]*?)</td>");
        Matcher m = p.matcher(r.text);
        java.util.HashSet<String> seen = new java.util.HashSet<>();
        while (m.find() && out.size() < limit) {
            String id = m.group(1);
            if (!seen.add(id)) continue;
            String name = cleanName(stripTags(m.group(2)));
            String artist = stripTags(m.group(3));
            if (name.isEmpty()) continue;
            out.add(new String[]{id, name, artist.isEmpty() ? "未知歌手" : artist, "0"});
        }
        return out;
    }

    /* ======================================================================
       取播放地址
       ====================================================================== */
    public static String resolve(String site, String id) throws IOException {
        String base = SITES.get(site);
        if (base == null) throw new IOException("未知聚合站 " + site);

        if (site.equals("gequhai")) return resolveGequhai(base, id);
        return resolveLaravel(base, id, site);
    }

    private static String resolveLaravel(String base, String id, String siteKey) throws IOException {
        String detail = base + "/music/" + id;
        Resp r = request(detail, "GET", null, base + "/", null);
        if (r.status != 200) throw new IOException("详情页返回 " + r.status);

        String playId = firstGroup(r.text,
                "\\\\u0022play_id\\\\u0022:\\\\u0022([^\\\\]+)\\\\u0022",
                "\"play_id\":\"([^\"]+)\"");
        if (playId == null) throw new IOException("未能解析出 play_id");

        String cover = firstGroup(r.text,
                "\\\\u0022mp3_cover\\\\u0022:\\\\u0022([^\\\\]+)\\\\u0022",
                "\"mp3_cover\":\"([^\"]+)\"");
        String dur = firstGroup(r.text,
                "\\\\u0022mp3_duration\\\\u0022:\\\\u0022([^\\\\]+)\\\\u0022",
                "\"mp3_duration\":\"([^\"]+)\"");

        String body = "id=" + Proxy.urlEncode(playId) + "&purpose=play";
        Resp api = request(base + "/member/common-play-url", "POST", body, detail,
                new String[]{
                        "Origin", base,
                        "X-Requested-With", "XMLHttpRequest",
                        "Accept", "application/json, text/javascript, */*; q=0.01"
                });

        String url = firstGroup(api.text, "\"url\":\"([^\"]+)\"");
        if (url == null) throw new IOException("取址接口未返回播放地址");
        url = url.replace("\\/", "/");

        String coverOut = cover == null ? "" : cover.replace("\\/", "/");
        if (coverOut.startsWith("http://")) coverOut = "https://" + coverOut.substring(7);

        StringBuilder sb = new StringBuilder();
        sb.append("{\"ok\":true,\"site\":\"").append(Json.esc(siteKey))
          .append("\",\"url\":\"").append(Json.esc(url))
          .append("\",\"cover\":\"").append(Json.esc(coverOut))
          .append("\",\"duration\":").append(parseDuration(dur)).append('}');
        return sb.toString();
    }

    private static String resolveGequhai(String base, String id) throws IOException {
        String detail = base + "/play/" + id;
        Resp r = request(detail, "GET", null, base + "/", null);
        if (r.status != 200) throw new IOException("播放页返回 " + r.status);

        String playId = firstGroup(r.text, "play_id\\s*=\\s*'([^']+)'");
        if (playId == null) throw new IOException("未能解析出 play_id");

        String cover = firstGroup(r.text, "mp3_cover\\s*=\\s*'([^']*)'");
        String type = firstGroup(r.text, "mp3_type\\s*=\\s*(\\d+)");

        String body = "id=" + Proxy.urlEncode(playId) + "&type=" + (type == null ? "0" : type);
        Resp api = request(base + "/api/music", "POST", body, detail,
                new String[]{
                        "Origin", base,
                        "X-Requested-With", "http",
                        "X-Custom-Header", "Key"
                });

        String url = firstGroup(api.text, "\"url\":\"([^\"]+)\"");
        if (url == null) {
            String msg = firstGroup(api.text, "\"msg\":\"([^\"]*)\"");
            throw new IOException(msg == null ? "取址接口未返回播放地址" : msg);
        }
        url = url.replace("\\/", "/");

        StringBuilder sb = new StringBuilder();
        sb.append("{\"ok\":true,\"site\":\"gequhai\",\"url\":\"").append(Json.esc(url))
          .append("\",\"cover\":\"").append(Json.esc(cover == null ? "" : cover))
          .append("\",\"duration\":0}");
        return sb.toString();
    }

    private static String firstGroup(String text, String... patterns) {
        for (String p : patterns) {
            Matcher m = Pattern.compile(p).matcher(text);
            if (m.find()) return m.group(1);
        }
        return null;
    }
}
