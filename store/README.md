# Publish to the Pebble app store

This folder has all the items that the app store requires. The listing text is
at the end of this document.

The store is the Core Devices developer dashboard:
<https://developer.repebble.com/dashboard>. Sign in with Google, GitHub or
Apple. Use the same method each time, because the account is attached to it.
An app is live immediately after you submit it. There is no review queue.

## Items for the store

| Item | Requirement | File |
| --- | --- | --- |
| App bundle | `.pbw` from a released SDK, 4.4 MB maximum | `dist/airport-wx_1.0.0_emery.pbw` (from `sh tools/package-release.sh` or the GitHub release) |
| UUID | Unique in the store. Do not change it after the first release. | `1e7fb206-2bf4-443a-af74-4c92b5c67f26` in `package.json` |
| Version | `major.minor.0`. A new value for each release. | `1.0.0` |
| Screenshots | 1 to 5 for each platform, 200 × 228 for emery, no watch frame | `store/screenshots/emery_*.png` (5) |
| Small icon | 80 × 80 (optional) | `store/icon-small-80.png` |
| Large icon | 144 × 144 (optional) | `store/icon-large-144.png` |
| Banner | 720 × 320 (optional) | `store/banner-720x320.png` |
| Category | daily, tools, notifications, remotes, health or games | `tools` (Tools & Utilities) |
| Permissions | `pebble.usesPermissions` in `package.json` | Internet (aviationweather.gov), Location |

To make the images again:

```sh
node tools/find-weather.mjs                       # stations below VFR now
sh tools/capture-store-screenshots.sh KAMA KLBB KRDU
python3 tools/make-store-assets.py                # icons and banner
```

## Publish with the dashboard

Use this method for the first release. The command-line tool cannot upload the
banner.

1. Build the bundle: `sh tools/package-release.sh`. Or download it from the
   GitHub release.
2. In the dashboard, click **New**. Upload the `.pbw`. The dashboard reads the
   name, UUID, version and platform from the file.
3. Paste the description (below). Select the category **Tools & Utilities**.
4. Upload the two icons, the five screenshots and the banner.
5. Leave the website and source code fields empty. The repository is private.
6. Paste the release notes (below).
7. Set the visibility to **Unlisted**. Click **Submit App**.
8. Copy the app's public link from the dashboard app list
   (`https://apps.repebble.com/<id>`). Open it on the phone. Make sure that
   the description and the icon show correctly. Cached store pages can take
   up to 10 minutes to update.
9. In the dashboard, change the visibility to **Listed**.

Visibility settings:

| Setting | Search and browse | Direct link and install |
| --- | --- | --- |
| Listed | Yes | Yes |
| Unlisted | No | Yes |
| Hidden | No | No |

Hidden takes an app offline. Nobody can find or install it, so do not use it
to preview a listing.

For each update:

1. Increase `version` in `package.json`.
2. Build the bundle again.
3. In the dashboard, click **New Release** on the app.

## Publish with the command line

```sh
pebble login                       # sign in with a browser, one time
sh tools/package-release.sh
pebble publish --pbw dist/airport-wx_1.0.0_emery.pbw \
  --non-interactive \
  --name "Airport Wx" \
  --category tools \
  --description "$(sed -n '/^<!-- description -->$/,/^<!-- \/description -->$/p' store/README.md | sed '1d;$d')" \
  --icon-small store/icon-small-80.png \
  --icon-large store/icon-large-144.png \
  --screenshots store/screenshots/emery_*.png \
  --release-notes "$(sed -n '/^<!-- notes -->$/,/^<!-- \/notes -->$/p' store/README.md | sed '1d;$d')"
```

The command makes the release unpublished. Publish it in the dashboard. Add
the banner in the dashboard.

## Listing text

**Name:** Airport Wx

**Category:** Tools & Utilities

**Description** (plain text):

<!-- description -->
Airport Wx shows the latest METAR and TAF for your airports on a Pebble Time 2.

PAGES
Home: Wind, visibility, ceiling, altimeter setting, temperature and dew point. The header shows the age of the report.
Wind: A compass rose with the runway. The app calculates the headwind and crosswind components.
TAF: The forecast periods and their flight categories. An asterisk (*) identifies a TEMPO or PROB group.
Raw: The full METAR text.

FLIGHT CATEGORY
A color block shows the value that sets the flight category. The footer shows the category name. The app uses the US category limits.

PERSONAL MINIMUMS
Set limits for wind, gust, crosswind, ceiling and visibility in the settings. A value past a limit shows in amber.

AIRPORTS
Set up to five airports in the settings. With no airport set, the app shows the nearest reporting station. You can also set the app to always open on the nearest station.

CONTROLS
Up or Down: Show the previous or next airport.
Select: Show the next page.
Hold Select: Show the nearest reporting station.
Swipe left or right: Show the next or previous page.
Drag up or down: Show the next or previous airport.
Tap: Refresh the report.

DATA AND PERMISSIONS
Weather data: NOAA Aviation Weather Center (aviationweather.gov).
Runway data: OurAirports.
Internet access: aviationweather.gov only.
Location: Only when you request the nearest station.

WARNING: This app is not a flight planning tool. Reports can be late, incorrect or missing. The runway on the Wind page is an estimate, not the active runway. Get an official weather briefing before each flight.
<!-- /description -->

**Release notes, 1.0.0:**

<!-- notes -->
First release. METAR and TAF for up to five airports and the nearest reporting station. Button and touch controls.
<!-- /notes -->
