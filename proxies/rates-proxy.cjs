// Proxy kursów: NBP (USD/EUR/złoto), CoinGecko (BTC/LTC), Yahoo (S&P500),
// paliwa scrapowane z autocentrum (średnia krajowa) + framework na kolejne źródła.
// Serwuje jeden JSON z CORS. Odporny na awarie pojedynczych źródeł.
const http = require("http");
const { execFile } = require("child_process");
const PORT = 8896;
let payload = "[]", ts = 0;
const FUEL_FALLBACK = { pb95: 6.53, diesel: 6.76 };
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

const grp = n => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const chg = (a, b) => (b ? ((a / b - 1) * 100) : null);
async function jget(u) {
  const r = await fetch(u, { headers: { "User-Agent": UA, "Accept": "application/json" } });
  if (!r.ok) throw new Error(u.slice(0, 46) + " " + r.status);
  return r.json();
}
async function scrapeText(u) { const r = await fetch(u, { headers: { "User-Agent": UA } }); if (!r.ok) throw new Error(u.split("/")[2] + " " + r.status); return r.text(); }
// curl fallback (Yahoo blokuje domyślny klient node fetch)
function curlText(u, ua) { return new Promise((res, rej) => execFile("curl", ["-s", "-m", "12", "-A", ua || UA, u], { maxBuffer: 8 * 1024 * 1024 }, (e, out) => e ? rej(e) : res(out))); }
async function curlJson(u, ua) { return JSON.parse(await curlText(u, ua)); }

// Ceny paliw z kilku źródeł, uśrednione (odstające > 20% od mediany odrzucane).
async function fuelPrices() {
  const rows = [];
  try { // Źródło 1: autocentrum — średnia krajowa z wielu stacji (Pb95 = "95", diesel = "ON")
    const h = await scrapeText("https://www.autocentrum.pl/paliwa/ceny-paliw/");
    const pb = /"name":"95","description":"[^"]*?:\s*([\d.]+)\s*zł/.exec(h);
    const on = /"name":"ON","description":"[^"]*?:\s*([\d.]+)\s*zł/.exec(h);
    if (pb && on) rows.push({ src: "autocentrum", pb95: +pb[1], diesel: +on[1] });
  } catch (e) { console.error("fuel autocentrum", e.message); }
  // (tu można dołożyć kolejne źródła; zostaną uśrednione z filtrem odstających)
  if (!rows.length) return null;
  const med = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const avg = key => { const v = rows.map(r => r[key]).filter(x => x > 0); const m = med(v); const k = v.filter(x => Math.abs(x / m - 1) <= 0.2); return k.reduce((a, b) => a + b, 0) / k.length; };
  return { pb95: avg("pb95"), diesel: avg("diesel"), n: rows.length };
}

async function build() {
  const out = [];
  const push = (k, v, c) => out.push(c == null ? { k, v } : { k, v, c });
  try {
    const [usd, eur, gold] = await Promise.all([
      jget("https://api.nbp.pl/api/exchangerates/rates/A/USD/last/2/?format=json"),
      jget("https://api.nbp.pl/api/exchangerates/rates/A/EUR/last/2/?format=json"),
      jget("https://api.nbp.pl/api/cenyzlota/last/2/?format=json"),
    ]);
    push("USD", usd.rates[1].mid.toFixed(3) + " zł", chg(usd.rates[1].mid, usd.rates[0].mid));
    push("EUR", eur.rates[1].mid.toFixed(3) + " zł", chg(eur.rates[1].mid, eur.rates[0].mid));
    push("Złoto", gold[1].cena.toFixed(2) + " zł/g", chg(gold[1].cena, gold[0].cena));
  } catch (e) { console.error("NBP", e.message); }
  try {
    const cg = await jget("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,litecoin&vs_currencies=pln&include_24hr_change=true");
    push("BTC", grp(cg.bitcoin.pln) + " zł", cg.bitcoin.pln_24h_change);
    push("LTC", cg.litecoin.pln.toFixed(2) + " zł", cg.litecoin.pln_24h_change);
  } catch (e) { console.error("CoinGecko", e.message); }
  try {
    const yh = await curlJson("https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?interval=1d&range=1d", "Mozilla/5.0");
    const m = yh.chart.result[0].meta;
    push("S&P 500", grp(m.regularMarketPrice), chg(m.regularMarketPrice, m.chartPreviousClose));
  } catch (e) { console.error("Yahoo", e.message); }
  let f = null; try { f = await fuelPrices(); } catch (e) { console.error("fuel", e.message); }
  const F = f || FUEL_FALLBACK;
  push("PB95", F.pb95.toFixed(2) + " zł");
  push("Diesel", F.diesel.toFixed(2) + " zł");
  return out;
}
let lastGood = {};
const ORDER = ["USD", "EUR", "Złoto", "BTC", "LTC", "S&P 500", "PB95", "Diesel"];
function refresh() {
  build().then(a => {
    for (const it of a) lastGood[it.k] = it;                 // zapamiętaj świeże
    const merged = ORDER.map(k => lastGood[k]).filter(Boolean); // uzupełnij brakujące ostatnimi dobrymi
    if (merged.length) { payload = JSON.stringify(merged); ts = Date.now(); console.log(new Date().toISOString(), "rates:", a.length, "/ shown", merged.length); }
  }).catch(e => console.error("build", e.message))
    .finally(() => setTimeout(refresh, 600000));
}
refresh();
http.createServer((req, res) => {
  if (req.url.startsWith("/rates")) { res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" }); return res.end(payload); }
  if (req.url === "/health") { res.writeHead(200, { "Access-Control-Allow-Origin": "*" }); return res.end("age=" + (Date.now() - ts) + "ms n=" + JSON.parse(payload).length); }
  res.writeHead(404); res.end();
}).listen(PORT, () => console.log("rates-proxy :" + PORT));
