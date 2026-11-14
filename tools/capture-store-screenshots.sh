#!/bin/sh
#
# Capture the app store screenshots from the emery emulator, with live data.
#
#   sh tools/capture-store-screenshots.sh KAMA KLBB KRDU
#   sh tools/capture-store-screenshots.sh --banner KLAX
#
# Arguments are three stations: the first is shown on Home, Wind and TAF, the
# second on Home only, the third on Home and Raw.  Pick them for the weather
# they have *now* -- the store listing is more useful with one field that is
# below VFR, so the category blocks are visible.  `tools/find-weather.mjs`
# lists the stations currently IFR or LIFR.
#
# Writes store/screenshots/emery_<n>_<page>.png at the native 200 x 228 the
# store requires (it rejects any other size, and framed shots).  With --banner,
# writes the Home and TAF pages of one station to store/banner/ instead, for
# tools/make-store-assets.py.  Needs the emulator set up as in
# docs/DEVELOPMENT.md and DISPLAY pointing at a display.
#
set -eu
cd "$(dirname "$0")/.."

# Long enough for a fetch to land and its loading indicator to go away.
SETTLE=${SETTLE:-10}

install_with() {
    pebble kill >/dev/null 2>&1 || true
    python3 tools/emu-settings.py "$@"
    pebble build >/dev/null
    # The first install after a cold boot can race the emulator; retry.
    for attempt in 1 2 3; do
        timeout 300 pebble install --emulator emery >/dev/null 2>&1 && break
        [ "$attempt" = 3 ] && { echo "install failed" >&2; exit 1; }
        sleep 10
    done
    sleep "$SETTLE"
}

if [ "${1:-}" = "--banner" ]; then
    [ $# -eq 2 ] || { echo "usage: $0 --banner STATION" >&2; exit 2; }
    mkdir -p store/banner
    echo "== banner: $2"
    install_with --home "$2"
    pebble screenshot --no-open store/banner/home.png >/dev/null
    pebble emu-button click select >/dev/null; sleep 1
    pebble emu-button click select >/dev/null; sleep "$SETTLE"
    pebble screenshot --no-open store/banner/taf.png >/dev/null
    pebble emu-button click back >/dev/null
    echo "  store/banner/home.png store/banner/taf.png"
    exit 0
fi

[ $# -eq 3 ] || { echo "usage: $0 STATION_HOME_WIND_TAF STATION_HOME STATION_HOME_RAW" >&2; exit 2; }
A=$1; B=$2; C=$3
OUT=store/screenshots

shot() {
    pebble screenshot --no-open "$OUT/emery_$1.png" >/dev/null
    echo "  $OUT/emery_$1.png"
}
press() {
    pebble emu-button click "$1" >/dev/null
    sleep "$SETTLE"
}

mkdir -p "$OUT"
rm -f "$OUT"/emery_*.png

echo "== configuring $A, $B, $C and installing"
install_with --home "$A" --also "$B" --also "$C"

echo "== capturing"
shot 1_home
press select; shot 2_wind
press select; shot 3_taf
press back
press down; shot 4_home
press down; press select; press select; press select; shot 5_raw
press back
