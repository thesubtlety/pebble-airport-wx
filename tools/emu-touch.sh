#!/bin/sh
#
# Drive the emery emulator's touchscreen from the command line.
#
#   sh tools/emu-touch.sh tap X Y
#   sh tools/emu-touch.sh swipe left|right
#   sh tools/emu-touch.sh drag up|down
#   sh tools/emu-touch.sh drag X0 Y0 X1 Y1 [STEPS] [STEP_DELAY_S]
#
# Coordinates are watch-screen pixels (0..199, 0..227).  QEMU feeds the touch
# device from the SDL window's mouse, so this moves the X pointer inside that
# window with xdotool.  The short pauses between moves matter: without them the
# moves arrive together and the watch sees a touch that never travelled.
#
# Needs xdotool and xwininfo (apt install xdotool x11-utils) and DISPLAY set to
# the display the emulator is on (:99 under tools/setup-dev.sh).
#
set -eu
export DISPLAY="${DISPLAY:-:99}"

geo=$(xwininfo -root -tree | grep '"QEMU"' | grep '200x228+' | head -1 \
      | sed -E 's/.*200x228\+([0-9]+)\+([0-9]+).*/\1 \2/')
[ -n "$geo" ] || { echo "no 200x228 QEMU window on $DISPLAY -- is the emery emulator running?" >&2; exit 1; }
ox=${geo% *}
oy=${geo#* }

drag() {
    x0=$1; y0=$2; x1=$3; y1=$4; n=${5:-8}; d=${6:-0.02}
    xdotool mousemove $((ox + x0)) $((oy + y0))
    sleep 0.05
    xdotool mousedown 1
    i=1
    while [ "$i" -le "$n" ]; do
        xdotool mousemove $((ox + x0 + (x1 - x0) * i / n)) $((oy + y0 + (y1 - y0) * i / n))
        sleep "$d"
        i=$((i + 1))
    done
    xdotool mouseup 1
}

case "${1:-}" in
    tap)
        xdotool mousemove $((ox + $2)) $((oy + $3))
        sleep 0.05
        xdotool mousedown 1
        sleep 0.08
        xdotool mouseup 1 ;;
    swipe)
        case "${2:-}" in
            left)  drag 170 110 30 110 ;;
            right) drag 30 110 170 110 ;;
            *) echo "swipe left|right" >&2; exit 2 ;;
        esac ;;
    drag)
        case "${2:-}" in
            up)   drag 100 170 100 60 ;;
            down) drag 100 60 100 170 ;;
            *)    shift; drag "$@" ;;
        esac ;;
    *)
        sed -n '3,9p' "$0" >&2; exit 2 ;;
esac
