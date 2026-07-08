// Proxy kamery Hikvision (ISAPI, digest auth) -> podaje klatki JPEG z nagłówkiem CORS.
//  - /cam.jpg     = pojedyncza, najświeższa klatka (używana przez dashboard: fetch -> blob -> objectURL)
//  - /cam.mjpeg   = strumień MJPEG (multipart/x-mixed-replace) dla <img src>
//  - /health      = wiek ostatniej klatki + licznik sekwencji
//
// Dlaczego proxy? Przeglądarka nie zrobi cross-origin fetch do kamery bez CORS,
// a dane logowania do kamery NIE mają prawa trafić do pliku HTML kiosku.
// Skalowanie do 720p (videoResolutionWidth/Height) robi SAMA kamera — mniejsza
// tekstura = dużo mniejsze obciążenie GPU na słabym mini-PC (np. Lenovo m625q).

const http = require("http");
const { execFile } = require("child_process");

// --- KONFIGURACJA: uzupełnij własnymi danymi ---
const CAM  = "http://CAMERA_IP/ISAPI/Streaming/channels/102/picture?videoResolutionWidth=1280&videoResolutionHeight=720";
const CRED = "uzytkownik:haslo";   // konto kamery (tylko podgląd)
const PORT = 8899;

let frame = null, ts = 0, seq = 0;

function grab() {
  execFile("curl", ["-s", "-m", "5", "--digest", "-u", CRED, CAM],
    { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 },
    (err, out) => {
      if (!err && out && out.length > 2000) { frame = out; ts = Date.now(); seq++; }
      setTimeout(grab, 450);   // odpytuj kamerę ~2x/s; dashboard i tak sięga rzadziej
    });
}
grab();

http.createServer((req, res) => {
  if (req.url.startsWith("/cam.mjpeg")) {
    res.writeHead(200, {
      "Content-Type": "multipart/x-mixed-replace; boundary=frame",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Pragma": "no-cache", "Connection": "close",
    });
    let last = -1, alive = true;
    req.on("close", () => { alive = false; });
    const tick = () => {
      if (!alive) return;
      if (frame && seq !== last) {
        last = seq;
        res.write("--frame\r\nContent-Type: image/jpeg\r\nContent-Length: " + frame.length + "\r\n\r\n");
        res.write(frame); res.write("\r\n");
      }
      setTimeout(tick, 120);
    };
    tick();
    return;
  }
  if (req.url.startsWith("/cam")) {
    if (!frame) { res.writeHead(503, { "Access-Control-Allow-Origin": "*" }); return res.end("no frame yet"); }
    res.writeHead(200, { "Content-Type": "image/jpeg", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store", "Content-Length": frame.length });
    return res.end(frame);
  }
  if (req.url === "/health") { res.writeHead(200, { "Access-Control-Allow-Origin": "*" }); return res.end("age=" + (Date.now() - ts) + "ms seq=" + seq); }
  res.writeHead(404); res.end();
}).listen(PORT, () => console.log("cam-proxy :" + PORT));
