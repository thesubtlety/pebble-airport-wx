# Development setup

Everything here was run on Ubuntu 24.04. The app builds, installs to the
`emery` emulator, fetches live weather and renders — all headless, which means
CI and an agent can both drive it.

## The fast loop (no SDK)

```sh
npm test         # the phone-side logic
npm run check-c  # typecheck the watchapp C against a stub SDK header (with
                 # and without PBL_TOUCH), and run the gesture classifier test
npm run check    # both
```

This needs only Node 22 and gcc. Use it for anything that is not a layout or
rendering question.

## The full loop (SDK + emulator)

Everything below is what `tools/setup-dev.sh` does. On a fresh Ubuntu box:

```sh
sh tools/setup-dev.sh
export PATH="$HOME/.local/bin:$PATH"
export DISPLAY=:99
```

It is idempotent, and re-running it is how you repair a half-finished install
or restore the IPv4 patch after a pebble-tool upgrade. The rest of this section
explains what it is doing and why, for when it needs changing.

### 1. Install

```sh
# Toolchain
curl -LsSf https://astral.sh/uv/install.sh | sh
uv tool install --force "pebble-tool==5.2.0" --python 3.13

# Emulator runtime deps
sudo apt install libsdl2-2.0-0 libglib2.0-0t64 libpixman-1-0 zlib1g libsndio7.0

# SDK, ARM toolchain and QEMU (~250 MB)
pebble sdk install 4.44
```

The tool and the SDK are pinned as a pair. SDK 4.44 (the touch API arrived in
4.33) refuses to install under pebble-tool older than 5.1.0, and `latest`
changes under you. The same pair is pinned in `tools/setup-dev.sh` and both
workflows.

`pebble sdk install` exits non-zero if the SDK is already present; scripts
should treat that as success. If an install was interrupted, the manifest can
survive without the toolchain — `pebble sdk uninstall <version>` and reinstall.

### 2. Headless display

The emulator opens an SDL window, so it needs a display even when nobody is
looking at it:

```sh
sudo apt install xvfb
Xvfb :99 -screen 0 1024x768x24 -nolisten tcp &
export DISPLAY=:99
```

### 3. The IPv6 patch

**On a host without IPv6, the emulator fails with `[Errno 111] Connection
refused` and nothing else.** It is not a networking problem you can fix from
outside: pypkjs (the phone simulator) binds its WebSocket server to the empty
host `""`, gevent resolves that to an `AF_INET6` socket, and the bind fails
before anything is logged.

Patch the two bind sites inside the uv-managed install, to loopback (nothing
outside this machine needs to reach the emulator):

```sh
PYPKJS="$(uv tool dir)/pebble-tool/lib/python3.13/site-packages/pypkjs"
sed -i 's/pywsgi.WSGIServer(("", self.port)/pywsgi.WSGIServer(("127.0.0.1", self.port)/' \
    "$PYPKJS/runner/websocket.py"
sed -i "s/http.server.HTTPServer(('', port)/http.server.HTTPServer(('127.0.0.1', port)/" \
    "$PYPKJS/runner/terminal.py"
```

Harmless on an IPv6-capable host, and it must be reapplied after every
`uv tool install` of pebble-tool. Check with `ip -6 addr show lo` — no output
means you need this.

Even patched, the first `pebble install --emulator emery` after the emulator
boots can still fail with `Connection refused`, because it races the boot. Run
it again; CI retries it.

### 4. Build, install, look

```sh
pebble build
pebble install --emulator emery
pebble screenshot --no-open docs/screenshots/01-home.png
```

Buttons, for driving the pages without a hand:

```sh
pebble emu-button click select   # next page
pebble emu-button click down     # next station
pebble emu-button click back
pebble emu-tap                   # flick -> nearest station
```

### 5. Settings, headless

The Clay settings page needs a browser. `tools/emu-settings.py` writes the same
object the app itself stores, straight into the emulator's localStorage:

```sh
pebble kill
python3 tools/emu-settings.py --home KRDU --also KBOS --also KASE
python3 tools/emu-settings.py --home KRDU --set tempUnit=c --set altimUnit=hpa
pebble install --emulator emery
```

### 6. Touch, headless

The emery emulator has a touchscreen, and QEMU feeds it from the SDL window's
mouse. Under Xvfb, `tools/emu-touch.sh` moves that mouse with `xdotool`:

```sh
sudo apt install xdotool x11-utils
sh tools/emu-touch.sh swipe left      # next page
sh tools/emu-touch.sh drag up         # next station
sh tools/emu-touch.sh tap 100 120     # refresh
```

The moves need short pauses between them. Sent all at once, they arrive
together and the watch sees a touch that never moved.

`pebble logs --emulator emery` prints how each touch was classified
(`touch: dx=-117 dy=0 -> gesture 2`).

The gesture recognizers in the SDK (`tap_recognizer_create` and friends) never
fired in the 4.44 emulator, with the touch bridge disabled as the header asks,
while the raw `touch_service` stream did. So the app reads the raw stream and
classifies a touch itself (`src/c/gesture.c`). Core's own touch example does
the same.

### 7. The loading indicator, without a slow network

Real fetches finish before a screenshot can catch them. Send the watch the
busy mask yourself (`STATUS` is key 10062; 1 = observation, 2 = forecast,
4 = nearest):

```sh
pebble send-app-message --emulator emery --uint 10062=4   # ring + LOCATING…
pebble screenshot --no-open busy.png
pebble send-app-message --emulator emery --uint 10062=0
```

## What the emulator does and does not prove

**Does.** That the app builds for `emery`; that the whole path works end to end
against the live API — URL building, JSON parsing, unit conversion, category
derivation, wind components, runway lookup, AppMessage, rendering; and that the
layout, fonts and colour rules land correctly on a real 200 × 228 frame.

**Does not.**

- **CORS.** pypkjs makes its requests through Python `requests`, not through
  the phone's JavaScript engine. Every request the app makes succeeds here,
  which exercises all of our own code — but it cannot answer whether the
  Repebble mobile app enforces browser CORS on `XMLHttpRequest`. The
  `apiBase` setting exists for that; see `INSTALL.md`, "If it cannot fetch".
- **Colour on hardware.** The emulator already renders the palette muted rather
  than saturated — `GColorGreen` comes back as roughly `#8EE391` in a
  screenshot, not `#00FF00` — which is a reasonable model of a transflective
  panel but not a substitute for one. The specification is explicit that every
  colour decision must be confirmed on the device, and that has not been done.
- **Anything physical.** Battery, the flick gesture against a real wrist,
  sunlight legibility, and how the gesture thresholds feel on the real panel
  (they are pixel distances in `src/c/gesture.h`).

## A trap the stub header cannot catch, and now does

The generated `MESSAGE_KEY_*` symbols are **runtime `uint32_t` variables**, not
compile-time constants — `message_keys.auto.c` defines them and the loader
fills them in. So this does not compile:

```c
static const uint32_t KEYS[2] = { MESSAGE_KEY_TAF_TIME_0, MESSAGE_KEY_TAF_TIME_1 };
// error: initializer element is not constant
```

The stub header originally modelled them as `#define` integers, which
typechecked happily and then failed under the real SDK. It now declares them
`extern uint32_t`, so `npm run check-c` rejects the same code the SDK rejects.
The general rule: **when the stub disagrees with the SDK, fix the stub.**
