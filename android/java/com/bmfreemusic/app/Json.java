package com.bmfreemusic.app;

import java.util.HashMap;
import java.util.Map;

/**
 * Json —— 极简 JSON 工具
 *
 * 只做两件事：解析前端发来的扁平对象（/api/raw 的请求体），以及转义回包里的字符串。
 */
public final class Json {

    private Json() { }

    /** 解析顶层对象，标量值转成字符串；嵌套结构直接跳过 */
    public static Map<String, String> parseObject(String src) {
        if (src == null) return null;
        Map<String, String> out = new HashMap<>();
        int[] pos = {0};
        int n = src.length();

        skipWs(src, pos);
        if (pos[0] >= n || src.charAt(pos[0]) != '{') return null;
        pos[0]++;

        while (pos[0] < n) {
            skipWs(src, pos);
            if (pos[0] >= n) break;
            char c = src.charAt(pos[0]);
            if (c == '}') { pos[0]++; break; }
            if (c == ',') { pos[0]++; continue; }
            if (c != '"') { pos[0]++; continue; }

            String key = readString(src, pos);
            skipWs(src, pos);
            if (pos[0] < n && src.charAt(pos[0]) == ':') pos[0]++;
            skipWs(src, pos);

            if (pos[0] >= n) break;
            char v = src.charAt(pos[0]);
            if (v == '"') {
                out.put(key, readString(src, pos));
            } else if (v == '{' || v == '[') {
                skipComposite(src, pos);
            } else {
                int start = pos[0];
                while (pos[0] < n) {
                    char ch = src.charAt(pos[0]);
                    if (ch == ',' || ch == '}') break;
                    pos[0]++;
                }
                String raw = src.substring(start, pos[0]).trim();
                if (!raw.isEmpty() && !raw.equals("null")) out.put(key, raw);
            }
        }
        return out;
    }

    private static void skipWs(String s, int[] pos) {
        while (pos[0] < s.length() && Character.isWhitespace(s.charAt(pos[0]))) pos[0]++;
    }

    private static String readString(String s, int[] pos) {
        StringBuilder sb = new StringBuilder();
        pos[0]++; // skip opening quote
        while (pos[0] < s.length()) {
            char c = s.charAt(pos[0]++);
            if (c == '"') break;
            if (c == '\\' && pos[0] < s.length()) {
                char e = s.charAt(pos[0]++);
                switch (e) {
                    case 'n': sb.append('\n'); break;
                    case 'r': sb.append('\r'); break;
                    case 't': sb.append('\t'); break;
                    case 'b': sb.append('\b'); break;
                    case 'f': sb.append('\f'); break;
                    case 'u':
                        if (pos[0] + 4 <= s.length()) {
                            try {
                                sb.append((char) Integer.parseInt(s.substring(pos[0], pos[0] + 4), 16));
                                pos[0] += 4;
                            } catch (NumberFormatException ignored) { }
                        }
                        break;
                    default: sb.append(e);
                }
            } else {
                sb.append(c);
            }
        }
        return sb.toString();
    }

    private static void skipComposite(String s, int[] pos) {
        char open = s.charAt(pos[0]);
        char close = open == '{' ? '}' : ']';
        int depth = 0;
        boolean inStr = false;
        while (pos[0] < s.length()) {
            char c = s.charAt(pos[0]++);
            if (inStr) {
                if (c == '\\') pos[0]++;
                else if (c == '"') inStr = false;
                continue;
            }
            if (c == '"') inStr = true;
            else if (c == open) depth++;
            else if (c == close) {
                depth--;
                if (depth == 0) return;
            }
        }
    }

    /** 字符串转义（用于拼装 JSON 回包） */
    public static String esc(String s) {
        if (s == null) return "";
        StringBuilder sb = new StringBuilder(s.length() + 16);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                case '\b': sb.append("\\b"); break;
                case '\f': sb.append("\\f"); break;
                default:
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        return sb.toString();
    }
}
