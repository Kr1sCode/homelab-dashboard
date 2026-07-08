# Proxy danych (warstwa CORS)

Dashboard to **pojedynczy plik HTML uruchamiany z `file://`** — przeglądarka nie pobierze więc
cross-origin danych bez nagłówka CORS, a części źródeł (kamera, prywatny kalendarz) nie wolno
odpytywać wprost z pliku, bo ujawniłoby to dane logowania. Rozwiązuje to zestaw mikro-proxy w
Node.js (zero zależności, każdy ~1 plik), uruchamianych na hoście w sieci lokalnej (u mnie
kontener LXC) jako usługi `systemd`:

| Usługa            | Port | Rola |
|-------------------|------|------|
| `cam-proxy.cjs`   | 8899 | Snapshot Hikvision (ISAPI, digest) → JPEG z CORS. Skalowanie do 720p po stronie kamery. |
| `ical-proxy.cjs`  | 8898 | Prywatny iCal (Google Calendar) → JSON. Parsowanie `VEVENT` + rozwijanie reguł `RRULE`. |
| `rss-proxy.cjs`   | 8897 | RSS (PAP MediaRoom) → JSON z tytułami dla paska przewijanego. |
| `rates-proxy.cjs` | 8896 | Kursy: NBP (USD/EUR/złoto), CoinGecko (BTC/LTC), Yahoo Finance (S&P500), ceny paliw. |

Wszystkie działają wg tego samego wzorca co dołączony **`cam-proxy.cjs`**:
odpytują źródło w tle w stałym interwale, trzymają ostatni wynik w pamięci i serwują go
pod prostym endpointem HTTP z nagłówkiem `Access-Control-Allow-Origin: *`.

## Przykład usługi systemd

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

> **Uwaga:** dane logowania (kamera, iCal) żyją wyłącznie w plikach proxy na serwerze,
> nigdy w pliku HTML kiosku.
