import com.bmfreemusic.app.Aggregator;
import java.util.regex.*;

public class TestAgg {
    public static void main(String[] args) throws Exception {
        String[] sites = {"gequbao", "xiagebao", "gequhai"};
        String kw = args.length > 0 ? args[0] : "周杰伦";
        for (String site : sites) {
            System.out.println("===== " + site + " =====");
            try {
                String json = Aggregator.search(site, kw, 3);
                System.out.println("  search: " + json);
                Matcher m = Pattern.compile("\"id\":\"(\\d+)\",\"name\":\"([^\"]*)\",\"artist\":\"([^\"]*)\"").matcher(json);
                if (!m.find()) { System.out.println("  no match"); continue; }
                String id = m.group(1);
                System.out.println("  取址 id=" + id + " (" + m.group(2) + ")");
                String play = Aggregator.resolve(site, id);
                System.out.println("  play: " + play);
            } catch (Exception e) {
                System.out.println("  ERR: " + e.getClass().getSimpleName() + " " + e.getMessage());
            }
        }
    }
}
