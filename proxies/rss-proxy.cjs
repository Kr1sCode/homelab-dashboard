// Proxy RSS (PAP MediaRoom): pobiera feed, wyciąga tytuły, serwuje JSON z CORS.
const http = require("http");
const { execFile } = require("child_process");
const FEED = "https://pap-mediaroom.pl/rss.xml";
const PORT = 8897;
let payload = "[]", ts = 0;
const dec = s => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&#8211;/g, "–").replace(/&#8217;/g, "’").replace(/&#8230;/g, "…")
  .replace(/&#8222;|&#8221;/g, '"').replace(/&nbsp;/g, " ")
  .replace(/&#?\w+;/g, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
function refresh() {
  execFile("curl", ["-s", "-m", "20", "-L", "-A", "Mozilla/5.0", FEED],
    { maxBuffer: 8 * 1024 * 1024, encoding: "utf8" },
    (err, out) => {
      if (!err && out && out.includes("<item>")) {
        try {
          const items = out.split("<item>").slice(1);
          const titles = items.map(it => { const m = it.match(/<title>([\s\S]*?)<\/title>/); return m ? dec(m[1]) : null; }).filter(t => t && t.length > 3);
          if (titles.length) { payload = JSON.stringify(titles); ts = Date.now(); console.log(new Date().toISOString(), "rss items:", titles.length); }
        } catch (e) { console.error("parse", e.message); }
      } else console.error("fetch", err && err.message);
      setTimeout(refresh, 600000); // co 10 min
    });
}
refresh();
http.createServer((req, res) => {
  if (req.url.startsWith("/rss")) { res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" }); return res.end(payload); }
  if (req.url === "/health") { res.writeHead(200, { "Access-Control-Allow-Origin": "*" }); return res.end("age=" + (Date.now() - ts) + "ms n=" + JSON.parse(payload).length); }
  res.writeHead(404); res.end();
}).listen(PORT, () => console.log("rss-proxy :" + PORT));
