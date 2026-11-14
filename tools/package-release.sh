#!/bin/sh
#
# Build a release .pbw and put it in dist/ with a checksum.
#
#   sh tools/package-release.sh            # version from package.json
#   sh tools/package-release.sh 1.2.0      # explicit version
#
# The only difference from a plain `pebble build` is that the JavaScript source
# map is dropped.  It is roughly half the bundle (333 KB of 651 KB), the phone
# never reads it, and nothing in the manifest references or checksums it -- the
# manifest covers only pebble-app.bin and app_resources.pbpack.  Keeping it in
# a development build is useful for debugging PebbleKit JS on device; shipping
# it just doubles the download.
#
set -eu

cd "$(dirname "$0")/.."

VERSION="${1:-$(node -p "require('./package.json').version")}"
OUT="dist"
NAME="airport-wx_${VERSION}_emery.pbw"

echo "== building"
npm install --no-audit --no-fund >/dev/null
pebble build

BUILT=$(ls build/*.pbw | head -1)
[ -f "$BUILT" ] || { echo "no .pbw produced by pebble build" >&2; exit 1; }

echo "== packaging $NAME"
mkdir -p "$OUT"
python3 - "$BUILT" "$OUT/$NAME" <<'PY'
import os, sys, zipfile

src, dst = sys.argv[1], sys.argv[2]
zin = zipfile.ZipFile(src)

# The manifest is the authority on what the watch actually loads.  Refuse to
# drop anything it names, so this stays safe if the SDK's bundle layout changes.
import json
protected = set()
for name in zin.namelist():
    if name.endswith('manifest.json'):
        manifest = json.loads(zin.read(name))
        prefix = name.rsplit('/', 1)[0] + '/' if '/' in name else ''
        for section in ('application', 'resources', 'worker'):
            entry = manifest.get(section) or {}
            if entry.get('name'):
                protected.add(prefix + entry['name'])

dropped = []
with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as zout:
    for info in zin.infolist():
        if info.filename.endswith('.js.map') and info.filename not in protected:
            dropped.append(info.filename)
            continue
        zout.writestr(info, zin.read(info.filename))

print('  dropped: %s' % (', '.join(dropped) or 'nothing'))
print('  %d -> %d bytes' % (os.path.getsize(src), os.path.getsize(dst)))
PY

echo "== verifying the bundle is still well formed"
python3 - "$OUT/$NAME" <<'PY'
import json, sys, zipfile

path = sys.argv[1]
z = zipfile.ZipFile(path)
bad = z.testzip()
if bad:
    sys.exit('corrupt entry in bundle: %s' % bad)

names = set(z.namelist())
info = json.loads(z.read('appinfo.json'))
for platform in info['targetPlatforms']:
    manifest = json.loads(z.read('%s/manifest.json' % platform))
    for section in ('application', 'resources'):
        entry = manifest.get(section) or {}
        name = entry.get('name')
        if not name:
            continue
        full = '%s/%s' % (platform, name)
        if full not in names:
            sys.exit('manifest names %s but it is not in the bundle' % full)
        if len(z.read(full)) != entry['size']:
            sys.exit('%s does not match the size the manifest declares' % full)
if 'pebble-js-app.js' not in names:
    sys.exit('the PebbleKit JS bundle is missing')

print('  %s v%s for %s: manifest consistent, JS present'
      % (info['longName'], info['versionLabel'], ', '.join(info['targetPlatforms'])))
PY

( cd "$OUT" && sha256sum "$NAME" > "${NAME}.sha256" )
echo
echo "$OUT/$NAME"
cat "$OUT/${NAME}.sha256"
