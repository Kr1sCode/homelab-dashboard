// Proxy iCal: pobiera prywatny feed Google Calendar, parsuje wydarzenia (z rozwijaniem RRULE)
// dla okna [początek bieżącego miesiąca .. +45 dni] i serwuje jako JSON z CORS.
// Sekretny URL zostaje TU (root-only), nie w HTML dashboardu.
const http = require("http");
const { execFile } = require("child_process");
const ICS = "https://calendar.google.com/calendar/ical/TWOJ_ADRES%40gmail.com/private-XXXXXXXXXXXX/basic.ics";  // prywatny URL iCal - trzymaj tylko tutaj
const PORT = 8898;
let payload = "[]", ts = 0;
const p2 = n => String(n).padStart(2, "0");

function parseDT(val, params) {
  const m = val.match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!m) return null;
  const allday = (params.VALUE === "DATE") || !m[4];
  return { y: +m[1], mo: +m[2], d: +m[3], H: m[4] ? +m[4] : 0, Mi: m[5] ? +m[5] : 0, utc: !!m[7], allday };
}
function parseRRule(v) { const o = {}; for (const kv of v.split(";")) { const [k, val] = kv.split("="); o[k] = val; } return o; }
function iso(b, y, mo, d) { return `${y}-${p2(mo)}-${p2(d)}T${p2(b.H)}:${p2(b.Mi)}:00${b.utc ? "Z" : ""}`; }
const DOW = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const dnum = (y, mo, d) => Date.UTC(y, mo - 1, d);
function weekStart(u) { const dd = new Date(u); return u - dd.getUTCDay() * 86400000; }

function occursOn(ev, u) {
  const b = ev.start, baseU = dnum(b.y, b.mo, b.d);
  if (u < baseU) return false;
  if (ev.exkeys && ev.exkeys.has(new Date(u).toISOString().slice(0, 10))) return false;
  const r = ev.rrule;
  if (!r) return u === baseU;
  if (ev._until && u > ev._until) return false;
  const iv = +(r.INTERVAL || 1), dd = new Date(u), dow = dd.getUTCDay();
  const dayDiff = Math.round((u - baseU) / 86400000);
  switch (r.FREQ) {
    case "DAILY": return dayDiff % iv === 0;
    case "WEEKLY": {
      const days = r.BYDAY ? r.BYDAY.split(",").map(x => DOW[x.slice(-2)]) : [new Date(baseU).getUTCDay()];
      if (!days.includes(dow)) return false;
      const wd = Math.round((weekStart(u) - weekStart(baseU)) / (7 * 86400000));
      return wd % iv === 0;
    }
    case "MONTHLY": {
      if (dd.getUTCDate() !== b.d) return false;
      const md = (dd.getUTCFullYear() - b.y) * 12 + (dd.getUTCMonth() - (b.mo - 1));
      return md % iv === 0;
    }
    case "YEARLY": {
      if (dd.getUTCMonth() !== (b.mo - 1) || dd.getUTCDate() !== b.d) return false;
      return (dd.getUTCFullYear() - b.y) % iv === 0;
    }
    default: return dayDiff === 0;
  }
}
function parse(text) {
  text = text.replace(/\r?\n[ \t]/g, "");
  const lines = text.split(/\r?\n/);
  const evs = []; let cur = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") { if (cur && cur.start) evs.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(":"); if (i < 0) continue;
    let key = line.slice(0, i); const val = line.slice(i + 1);
    let params = {}; const s = key.indexOf(";");
    if (s >= 0) { for (const pp of key.slice(s + 1).split(";")) { const [k, v] = pp.split("="); params[k] = v; } key = key.slice(0, s); }
    if (key === "SUMMARY") cur.summary = val.replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\n/gi, " ").trim();
    else if (key === "DTSTART") cur.start = parseDT(val, params);
    else if (key === "RRULE") cur.rrule = parseRRule(val);
    else if (key === "EXDATE") { cur.exkeys = cur.exkeys || new Set(); for (const v of val.split(",")) { const dt = parseDT(v, params); if (dt) cur.exkeys.add(`${dt.y}-${p2(dt.mo)}-${p2(dt.d)}`); } }
    else if (key === "RECURRENCE-ID") cur._skip = true;
  }
  return evs;
}
function build(evs) {
  const now = new Date();
  const winStart = dnum(now.getFullYear(), now.getMonth() + 1, 1);
  const winEnd = Date.now() + 45 * 86400000;
  const out = [];
  for (const ev of evs) {
    if (ev._skip || !ev.summary) continue;
    if (!ev.rrule) { // jednorazowe — sprawdź tylko własną datę
      const bu = dnum(ev.start.y, ev.start.mo, ev.start.d);
      if (bu >= winStart && bu <= winEnd) out.push({ title: ev.summary, iso: iso(ev.start, ev.start.y, ev.start.mo, ev.start.d), allday: ev.start.allday });
      continue;
    }
    if (ev.rrule.UNTIL) { const u = ev.rrule.UNTIL.match(/(\d{4})(\d{2})(\d{2})/); if (u) ev._until = dnum(+u[1], +u[2], +u[3]); }
    for (let u = winStart; u <= winEnd; u += 86400000) {
      const dd = new Date(u);
      if (occursOn(ev, u)) out.push({ title: ev.summary, iso: iso(ev.start, dd.getUTCFullYear(), dd.getUTCMonth() + 1, dd.getUTCDate()), allday: ev.start.allday });
    }
  }
  out.sort((a, b) => a.iso < b.iso ? -1 : 1);
  return out;
}
function refresh() {
  execFile("curl", ["-s", "-m", "20", ICS], { maxBuffer: 32 * 1024 * 1024 }, (err, out) => {
    if (!err && out && out.includes("BEGIN:VEVENT")) {
      try { payload = JSON.stringify(build(parse(out))); ts = Date.now(); console.log(new Date().toISOString(), "events:", JSON.parse(payload).length); }
      catch (e) { console.error("parse err", e.message); }
    } else console.error("fetch err", err && err.message);
    setTimeout(refresh, 300000); // co 10 min
  });
}
refresh();
http.createServer((req, res) => {
  if (req.url.startsWith("/events")) {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" });
    return res.end(payload);
  }
  if (req.url === "/health") { res.writeHead(200, { "Access-Control-Allow-Origin": "*" }); return res.end("age=" + (Date.now() - ts) + "ms n=" + JSON.parse(payload).length); }
  res.writeHead(404); res.end();
}).listen(PORT, () => console.log("ical-proxy :" + PORT));
