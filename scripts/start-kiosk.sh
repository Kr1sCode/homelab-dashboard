#!/usr/bin/env bash
# start-kiosk.sh — uruchamia dashboard w trybie kiosk (pełny ekran, bez ramek).
#
# Odpala Chromium/Chrome w trybie --kiosk na wskazanym pliku HTML, z wyłączonym
# wygaszaczem/oszczędzaniem energii, tak by ekran świecił 24/7. Pomyślany pod
# XFCE na słabym mini-PC (np. Lenovo m625q), ale zadziała na dowolnym Linuksie z X11.
#
# Użycie:
#   ./start-kiosk.sh                      # domyślnie wersja pionowa obok skryptu
#   ./start-kiosk.sh /sciezka/do/plik.html
#   KIOSK_FILE=/opt/kiosk/homelab-kiosk.html ./start-kiosk.sh   # wersja pozioma
set -euo pipefail

# --- co wyświetlić ---------------------------------------------------------
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIOSK_FILE="${1:-${KIOSK_FILE:-$HERE/../homelab-kiosk-pion.html}}"
KIOSK_FILE="$(readlink -f "$KIOSK_FILE")"

if [[ ! -f "$KIOSK_FILE" ]]; then
  echo "start-kiosk: nie znaleziono pliku: $KIOSK_FILE" >&2
  exit 1
fi
URL="file://$KIOSK_FILE"

# --- znajdź przeglądarkę ---------------------------------------------------
BROWSER=""
for b in chromium chromium-browser google-chrome google-chrome-stable brave-browser; do
  if command -v "$b" >/dev/null 2>&1; then BROWSER="$b"; break; fi
done
if [[ -z "$BROWSER" ]]; then
  echo "start-kiosk: brak Chromium/Chrome. Zainstaluj: sudo apt install chromium" >&2
  exit 1
fi

# --- wyłącz wygaszanie ekranu i DPMS (jeśli dostępne) ----------------------
if command -v xset >/dev/null 2>&1; then
  xset s off || true          # bez wygaszacza
  xset s noblank || true       # nie wygaszaj do czerni
  xset -dpms || true           # bez zarządzania energią monitora
fi
# ukryj kursor po chwili bezczynności (jeśli jest unclutter)
command -v unclutter >/dev/null 2>&1 && (unclutter -idle 3 &) || true

# --- osobny, trwały profil (zapamiętuje ustawienia, nie pyta o restory) -----
PROFILE="${KIOSK_PROFILE:-$HOME/.config/kiosk-chrome}"
mkdir -p "$PROFILE"
# skasuj flagi „crash/exit", żeby po nagłym wyłączeniu nie wyskakiwał dymek
if [[ -f "$PROFILE/Default/Preferences" ]]; then
  sed -i 's/"exit_type":"[^"]*"/"exit_type":"Normal"/; s/"exited_cleanly":false/"exited_cleanly":true/' \
    "$PROFILE/Default/Preferences" 2>/dev/null || true
fi

# --- start -----------------------------------------------------------------
exec "$BROWSER" \
  --user-data-dir="$PROFILE" \
  --kiosk "$URL" \
  --start-fullscreen \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-features=TranslateUI,Translate \
  --check-for-update-interval=31536000 \
  --disable-pinch \
  --overscroll-history-navigation=0 \
  --autoplay-policy=no-user-gesture-required \
  --password-store=basic
