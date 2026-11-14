# Installing on a watch

> **Not a flight planning tool.** A convenience display of publicly available
> weather. Reports can be late, wrong or missing; the runway it shows is a
> guess and not the active runway; the flight category uses US definitions.
> Get an official weather briefing before flight.

**Pebble Time 2 (`emery`) only.** The bundle targets one platform, so it will
not install on a Pebble Time, Time Steel, Time Round or Pebble 2. If you want
it on another watch, add the platform to `targetPlatforms` in `package.json`
and rebuild — but read the caveat at the bottom first, because the layout is
tuned for a 200 × 228 screen.

## Get the file

Either download `airport-wx_<version>_emery.pbw` from the
[releases page](../../../releases), or build it yourself:

```sh
sh tools/setup-dev.sh          # first time only
sh tools/package-release.sh    # -> dist/airport-wx_1.0.0_emery.pbw
```

## Option 1 — open the file on your phone (easiest)

1. Get the `.pbw` onto your phone: email it to yourself, AirDrop it, put it in
   Drive/Dropbox, or download it from the releases page in the phone's browser.
2. Tap it. It should open in the **Pebble** app (Pebble Core on iOS), which
   installs it to the watch.

On Android, some versions refuse to offer the Pebble app as a handler for
`.pbw`. If the tap does nothing useful, install
[Sideload Helper by Rebble](https://github.com/pebble-dev/rebble-sideloader),
which exists solely to register that file type.

## Option 2 — install over the network (best for iterating)

This is worth the two minutes of setup if you plan to change anything, because
it also gives you live logs from the watch.

1. In the Pebble mobile app, turn on the **Developer Connection** (Settings →
   Developer Mode). It shows the phone's IP address.
2. On your computer, with the phone and computer on the same network:

```sh
export PEBBLE_PHONE=192.168.1.42        # the IP the app showed you
pebble install --phone "$PEBBLE_PHONE" dist/airport-wx_1.0.0_emery.pbw
pebble logs --phone "$PEBBLE_PHONE"     # live app logs from the watch
```

`pebble logs` is how you would see, for example, an `AppMessage rejected` line
or the app complaining that `app_message_open` could not get the buffer it
asked for.

## Set it up

With no airport set, the app shows the nearest reporting station, from the
phone's location. To set airports, in the Pebble mobile
app, open the watchapp's **Settings** and set:

- **Home airport** — a four-character ICAO identifier, e.g. `KRDU`. The field
  checks it against the live API as you leave it and tells you the airport's
  name, or that it is not reporting.
- **Also show** (optional) — up to four more; Up and Down cycle through them.
- **Units**, **Personal minima**, **Runway**, and the rest are all optional.

Then open the app. If it sits on `FETCHING…`, the phone cannot reach the
Aviation Weather Center — see the note below.

## Using it

| Input | Does |
| --- | --- |
| Up / Down | Previous / next configured station. On the raw page, scrolls |
| Select | Next page: Home → Wind → TAF → Raw → Home |
| Select, held | Nearest reporting station (needs location permission) |
| Back | Back to Home; from Home, exits |
| Flick your wrist | Nearest reporting station, if enabled in settings |
| Swipe left / right | Next / previous page |
| Drag up / down | Next / previous station; on the raw page, scrolls |
| Tap | Fetch again now |

Touch needs touch turned on in the watch's settings (Settings → Display →
Touch). A small turning ring next to the age means a fetch is in progress.

The age in the top right is the age of the **observation**, computed on the
watch, so it keeps counting up correctly with the phone out of range. Grey
under 45 minutes, amber to 75, red beyond. If it is red, you are looking at
something old and the watch is telling you so.

## If it cannot fetch

The one thing that could not be tested without hardware is whether the phone
app enforces browser CORS on the request to aviationweather.gov. If everything
else works but the app never gets data:

1. Check `pebble logs --phone $PEBBLE_PHONE` for the failure.
2. If it is a CORS rejection, put an https proxy in front of the API and set
   **Settings → Advanced → API base URL** to it. The app validates that the
   value is `https://` and appends the endpoint paths itself, so a proxy that
   forwards `/metar` and `/taf` to `aviationweather.gov/api/data/` is enough.
   **This needs a rebuild.** The phone only lets the app reach hosts declared
   in `package.json` → `pebble.usesPermissions`, which lists only
   `aviationweather.gov`. Add your proxy's host to that `domains` list and
   rebuild. A store build pointed at an undeclared proxy gets every request
   refused.

Please open an issue either way: whether the phone app enforces CORS is not
yet confirmed on hardware.

## Porting to another watch

`targetPlatforms` in `package.json` is the switch, but it is not the whole job.
All geometry is written against 200 × 228 and scaled to the real bounds at draw
time (`SX`/`SY` in `src/c/avwx.h`), so a different screen will lay out without
crashing — but the fonts do not scale, and on the smaller round or 144 × 168
screens the three-row home page will be tight. `gabbro` (Time 2 Round, 260 ×
260) is the most likely to look right with only a layout pass.

On a black-and-white watch the category blocks lose their colour entirely,
which breaks the design's main signal. §13 of the specification suggests a 50%
dither pattern instead; nobody has written that yet.
