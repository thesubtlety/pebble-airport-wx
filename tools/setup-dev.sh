#!/bin/sh
#
# Install everything needed to build Airport Wx and run it in the emulator,
# headless.  Idempotent: safe to re-run, and re-running is how you repair a
# half-finished install.
#
#   sh tools/setup-dev.sh
#
# Then:
#   export DISPLAY=:99
#   pebble build && pebble install --emulator emery
#
# See docs/DEVELOPMENT.md for what each step is working around.
#
set -eu

# Pinned together: SDK 4.44 refuses to install under pebble-tool older than
# 5.1.0, and "latest" moves under you.  Bump both deliberately.
PEBBLE_TOOL_VERSION=5.2.0
PEBBLE_SDK_VERSION=4.44
PYTHON_VERSION=3.13

say() { printf '\n== %s\n' "$1"; }

say "system packages"
if command -v apt-get >/dev/null 2>&1; then
    SUDO=""
    [ "$(id -u)" = "0" ] || SUDO="sudo"
    DEBIAN_FRONTEND=noninteractive $SUDO apt-get update -qq
    # libsdl2 and friends are the emulator's runtime; xvfb gives it a display
    # to open its window on when there is nobody to look at it.
    DEBIAN_FRONTEND=noninteractive $SUDO apt-get install -y -qq \
        libsdl2-2.0-0 libglib2.0-0t64 libpixman-1-0 zlib1g libsndio7.0 xvfb \
        || DEBIAN_FRONTEND=noninteractive $SUDO apt-get install -y -qq \
           libsdl2-2.0-0 libglib2.0-0 libpixman-1-0 zlib1g libsndio7.0 xvfb
else
    echo "not apt-based; install SDL2, glib, pixman, zlib, sndio and Xvfb yourself"
fi

say "uv"
if ! command -v uv >/dev/null 2>&1; then
    curl -LsSf https://astral.sh/uv/install.sh | sh
fi
PATH="$HOME/.local/bin:$PATH"
export PATH

say "pebble-tool $PEBBLE_TOOL_VERSION"
uv tool install --force "pebble-tool==$PEBBLE_TOOL_VERSION" --python "$PYTHON_VERSION"

say "Pebble SDK $PEBBLE_SDK_VERSION"
# Exits non-zero when the SDK is already installed, which is not a failure --
# so check for it afterwards instead of trusting the exit code.
pebble sdk install "$PEBBLE_SDK_VERSION" || true
pebble sdk activate "$PEBBLE_SDK_VERSION" >/dev/null 2>&1 || true
pebble sdk list | grep -q "^$PEBBLE_SDK_VERSION (active)" || {
    echo "SDK $PEBBLE_SDK_VERSION is not installed and active" >&2; exit 1; }

say "IPv4 bind patch"
# On a host without IPv6, pypkjs binds its websocket to the empty host, gevent
# resolves that to an AF_INET6 socket, and the emulator dies with a bare
# "[Errno 111] Connection refused" and no other clue.  Harmless where IPv6
# works.  Loopback rather than 0.0.0.0: the emulator and the tools that talk
# to it are all on this machine, so nothing needs to reach it from outside.
# Must be reapplied after every pebble-tool install, hence its place here
# rather than in a one-off note.
PYPKJS="$(uv tool dir)/pebble-tool/lib/python$PYTHON_VERSION/site-packages/pypkjs"
if [ -d "$PYPKJS" ]; then
    sed -i 's/pywsgi\.WSGIServer(("", self\.port)/pywsgi.WSGIServer(("127.0.0.1", self.port)/' \
        "$PYPKJS/runner/websocket.py"
    sed -i "s/http\.server\.HTTPServer(('', port)/http.server.HTTPServer(('127.0.0.1', port)/" \
        "$PYPKJS/runner/terminal.py"
    echo "patched $PYPKJS to bind IPv4 loopback"
else
    echo "WARNING: pypkjs not found at $PYPKJS -- skipping the IPv4 patch"
fi

say "node dependencies"
npm install --no-audit --no-fund

say "headless display"
if [ -z "${DISPLAY:-}" ] && ! pgrep -x Xvfb >/dev/null 2>&1; then
    Xvfb :99 -screen 0 1024x768x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &
    echo "started Xvfb on :99 -- run: export DISPLAY=:99"
else
    echo "display already available"
fi

say "verifying"
# Explicit failures.  Under `set -e` a failing command on the left of && does
# not stop the script, so "cmd && echo ok" used to print Ready after a failed
# build.
npm test >/dev/null || { echo "phone-side tests FAILED (run npm test)" >&2; exit 1; }
echo "phone-side tests pass"
sh tools/check-c.sh
pebble build >/dev/null || { echo "pebble build FAILED (run pebble build)" >&2; exit 1; }
echo "pebble build succeeded"

cat <<'EOF'

Ready.  To run it:

    export PATH="$HOME/.local/bin:$PATH"
    export DISPLAY=:99
    python3 tools/emu-settings.py --home KRDU --also KBOS
    pebble install --emulator emery   # run it again if the first one races the boot
    pebble screenshot --no-open shot.png

EOF
