# Data proxies (CORS layer)

The dashboard is a **single HTML file run from `file://`** — so the browser can't fetch
cross-origin data without a CORS header, and some sources (the camera, the private calendar)
must not be queried straight from the file, as that would expose credentials. This is solved
by a set of Node.js micro-proxies (zero dependencies, ~1 file each), running on a host on the
local network (an LXC container in my case) as `systemd` services:

| Service           | Port | Role |
|-------------------|------|------|
| `cam-proxy.cjs`   | 8899 | Hikvision snapshot (ISAPI, digest) → JPEG with CORS. Scaled to 720p on the camera side. |
| `ical-proxy.cjs`  | 8898 | Private iCal (Google Calendar) → JSON. Parses `VEVENT` + expands `RRULE` rules. |
| `rss-proxy.cjs`   | 8897 | RSS (PAP MediaRoom) → JSON with titles for the scrolling ticker. |
| `rates-proxy.cjs` | 8896 | Rates: NBP (USD/EUR/gold), CoinGecko (BTC/LTC), Yahoo Finance (S&P 500), fuel prices. |

They all follow the same pattern as the included **`cam-proxy.cjs`**: poll the source in the
background at a fixed interval, keep the latest result in memory and serve it from a simple
HTTP endpoint with an `Access-Control-Allow-Origin: *` header.

## systemd service example

```ini
# /etc/systemd/system/cam-proxy.service
[Unit]
Description=Hikvision snapshot proxy for kiosk
After=network-online.target

[Service]
ExecStart=/usr/bin/node /opt/kiosk/proxies/cam-proxy.cjs
Restart=always
User=nobody

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now cam-proxy.service
```

> **Note:** credentials (camera, iCal) live only in the proxy files on the server,
> never in the kiosk HTML file.
