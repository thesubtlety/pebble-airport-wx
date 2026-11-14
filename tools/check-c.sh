#!/bin/sh
# Typecheck every C source against the stub SDK header.  This is not a build --
# it produces no binary and cannot replace `pebble build` -- but it catches the
# typos, wrong signatures and missing declarations that would otherwise only
# surface on a machine with the SDK installed.
set -e
cd "$(dirname "$0")/.."
FLAGS="-fsyntax-only -std=c11 -Wall -Wextra -Werror -Wno-unused-parameter -Itools/pebble-stub -Isrc/c"
# Twice: once as a touch platform (emery, which the app ships for) and once
# without, so the button-only path a port to another watch would take stays
# compilable too.
for variant in "-DPBL_TOUCH" ""; do
  for f in src/c/*.c; do
    # shellcheck disable=SC2086
    gcc $FLAGS $variant "$f"
  done
done
echo "C sources typecheck against the stub SDK header ($(ls src/c/*.c | wc -l | tr -d ' ') files, with and without PBL_TOUCH)"

# The gesture classifier has no SDK dependency, so it is compiled for the host
# and its test actually runs.
OUT="${TMPDIR:-/tmp}/avwx-gesture-test.$$"
gcc -std=c11 -Wall -Wextra -Werror -Isrc/c -o "$OUT" test/gesture_test.c src/c/gesture.c
"$OUT"
rm -f "$OUT"
