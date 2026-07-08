# HOME-LAB · Mission Control

**Jednoplikowy dashboard kiosk dla domowego home-laba** — jeden ekran, na którym w czasie
rzeczywistym widać kondycję całej infrastruktury i kilka rzeczy z życia codziennego. Zero
frameworków, zero procesu budowania, zero zależności: cały interfejs to **jeden plik HTML**
z ręcznie rysowanymi wykresami SVG, uruchamiany na dedykowanym mini-PC w trybie pełnoekranowym.

Estetyka celowo utrzymana w klimacie **„mission control z XXII wieku"** — ciemne tło, miętowo-turkusowy
akcent i font monospace, dopasowane kolorystycznie do [krzysztofgawkowski.pl](https://krzysztofgawkowski.pl).

![Dashboard na monitorze pionowym](docs/dashboard.jpg)

---

## 🧭 Od strony praktycznej — do czego to służy

Zamiast logować się do kilku osobnych paneli (osobno monitoring hostów, osobno statusy usług,
osobno kamera, pogoda, kalendarz…), mam **jeden zawsze-włączony ekran**, który sam wszystko
zbiera i pokazuje. Wisi na ścianie na monitorze w orientacji pionowej i po prostu działa —
bez klikania, bez logowania, bez utrzymania.

Na jednym widoku:

- **Dostępność 24 h** wszystkich monitorowanych usług (z Uptime Kuma),
- **Temperatury hostów** z progami kolorów (zielony → pomarańczowy → czerwony),
- **Ruch sieciowy** — zagregowany wykres góra/dół całego home-laba,
- **Kursy** — USD, EUR, złoto, BTC, LTC, S&P500, ceny paliw (Pb95 / diesel),
- **Kalendarz miesiąca** z wydarzeniami z prywatnego Google Calendar,
- **Podgląd z kamery IP** (Hikvision) na żywo,
- **Pogoda** dla wybranej lokalizacji + prognoza na 5 dni,
- **Pasek RSS** z nagłówkami (PAP MediaRoom) oraz zegar i data.

**Kluczowa cecha: pełna automatyka.** Dodajesz nowy host w Beszelu albo nowy monitor w Uptime
Kuma — pojawia się na dashboardzie sam, bez dotykania kodu. Nic nie trzeba klikać ani restartować.

---

## ✨ Funkcje

- 🖥️ **Jeden plik, zero zależności** — działa z `file://`, offline-first, nic nie instaluje.
- 🔁 **Full-auto** — nowe hosty/monitory zaciągają się automatycznie.
- 🔄 **Rotacja wpisów** — panele dostępności i temperatur przewijają kolejne strony co 10 s (licznik `1/3`, `2/3`…), więc mieści się dowolna liczba pozycji.
- 📈 **Ręcznie rysowane wykresy SVG** — sparkline’y i wykresy obszarowe bez żadnej biblioteki.
- 📷 **Kamera w przeglądarce mimo RTSP** — snapshot proxy + `fetch → blob → objectURL` + podwójne buforowanie z `img.decode()` (brak migotania), etykieta **NA ŻYWO / OFFLINE** wg stanu łącza.
- 🌡️ **Progi kolorów** dla temperatur i dostępności.
- 🖼️ **Dwie orientacje** — osobne pliki: pozioma i pionowa, generowane ze wspólnego źródła.
- ⚡ **Zoptymalizowane pod słaby GPU** (Lenovo m625q) — izolacja warstw kompozytora, skalowanie kamery do 720p.
- 🎨 **Spójna identyfikacja wizualna** z prywatną stroną autora.

---

## 🏗️ Od strony technicznej — jak to działa

### Architektura

```
┌──────────────────────────────┐        LAN         ┌───────────────────────────┐
│  Mini-PC (kiosk)             │  ───── HTTP ─────▶  │  Host LXC / serwer .7     │
│  Debian + XFCE               │                    │                           │
│  przeglądarka pełny ekran    │  ◀── JSON/JPEG ──   │  mikro-proxy (Node.js):   │
│  homelab-kiosk-pion.html     │                    │   • cam-proxy   :8899     │
└──────────────────────────────┘                    │   • ical-proxy  :8898     │
        │  bezpośrednio (CORS OK)                    │   • rss-proxy   :8897     │
        ▼                                            │   • rates-proxy :8896     │
   Beszel :8090  (metryki hostów)                    └───────────────────────────┘
   Uptime Kuma :3001  (statusy usług)                          │
   Open-Meteo API  (pogoda)                                    ▼
                                                    kamera Hikvision / Google iCal /
                                                    PAP RSS / NBP / CoinGecko / Yahoo
```

Front-end łączy się **wprost** ze źródłami, które podają CORS (Beszel, Uptime Kuma, Open-Meteo),
a wszystko, co CORS-u nie podaje lub wymaga poświadczeń (kamera, kalendarz, RSS, kursy),
przechodzi przez **warstwę mikro-proxy** w Node.js (opis: [`proxies/`](proxies/)). Dzięki temu
żadne dane logowania nie trafiają do pliku HTML.

### Źródła danych

| Widget | Źródło | Sposób pobrania |
|---|---|---|
| Dostępność 24 h | Uptime Kuma (SQLite/Express) | bezpośrednio, konto read-only |
| Temperatury / metryki | Beszel (PocketBase) | bezpośrednio, konto read-only |
| Ruch sieciowy | Beszel — agregacja wszystkich hostów | liczone w kliencie |
| Pogoda + prognoza | Open-Meteo | bezpośrednio (publiczne, CORS) |
| Kamera | Hikvision ISAPI (digest) | `cam-proxy` → JPEG 720p |
| Kalendarz | prywatny Google Calendar (iCal) | `ical-proxy` (parser `RRULE`) |
| Pasek RSS | PAP MediaRoom | `rss-proxy` |
| Kursy | NBP, CoinGecko, Yahoo Finance, ceny paliw | `rates-proxy` (uśrednianie + odrzut wartości odstających) |

### Rendering i wydajność

- **Wykresy** rysowane ręcznie jako inline SVG (ścieżki `path`) — brak D3/Chart.js itp.
- **Układ** na CSS Grid (`grid-template-areas`), animacje wyłącznie na `transform`/`opacity` (wątek kompozytora).
- **Kamera bez migotania** — dwa `<img>` przełączane naprzemiennie, nowa klatka pokazywana dopiero po `await img.decode()`.
- **Optymalizacja pod iGPU** — panel kamery i nagłówek z tickerem wydzielone na osobne warstwy
  kompozytora (`contain` + `translateZ(0)` + `isolation`), tak by ~1 Mpix tekstury kamery nie
  wymuszało re-rasteryzacji reszty ekranu. Kamera skalowana do 720p już po stronie Hikvision.
- **Odświeżanie** — dane co 60 s, kamera co 1,2 s, zegar co 10 s, jeden „miękki" reload na dobę.

### Stack

`HTML5` · `CSS Grid` · `Vanilla JavaScript (ES6+)` · `SVG` · `Node.js` (proxy) ·
`systemd` · `Beszel` · `Uptime Kuma` · `Open-Meteo` · `Hikvision ISAPI`

---

## 📁 Struktura repo

```
.
├── homelab-kiosk-pion.html   # dashboard — wersja PIONOWA (na monitor w pionie)
├── proxies/                  # warstwa CORS (Node.js, systemd)
│   ├── cam-proxy.cjs         # proxy kamery Hikvision (przykład kompletny)
│   └── README.md             # opis wszystkich czterech proxy
├── docs/
│   └── dashboard.jpg         # zdjęcie działającego kiosku
└── README.md
```

## 🚀 Uruchomienie

1. Uzupełnij blok `CONFIG` na górze `homelab-kiosk-pion.html` własnymi adresami (placeholdery `10.0.0.x`).
2. Postaw mikro-proxy z katalogu [`proxies/`](proxies/) jako usługi systemd.
3. Otwórz plik w przeglądarce w trybie kiosk (pełny ekran) na dedykowanej maszynie.

> ⚠️ **Uwaga bezpieczeństwa:** blok `CONFIG` w tym repo zawiera wyłącznie przykładowe
> placeholdery. Nie commituj tu prawdziwych adresów IP ani haseł — poświadczenia trzymaj
> tylko w plikach proxy na serwerze.

---

## 👤 Autor

**Krzysztof Gawkowski** — [krzysztofgawkowski.pl](https://krzysztofgawkowski.pl) · [github.com/Kr1sCode](https://github.com/Kr1sCode)

## 📄 Licencja

MIT — patrz [`LICENSE`](LICENSE).
