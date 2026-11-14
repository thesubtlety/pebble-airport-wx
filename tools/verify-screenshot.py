#!/usr/bin/env python3
"""
Assert that an emulator screenshot shows a running app rather than a crash.

A build that compiles is not a build that runs.  The watchapp can pass every
compiler check and still fault on launch -- a bad pointer in a page's update
proc, an AppMessage buffer the system would not grant -- and the only way to
find that out is to start it and look.

The checks are deliberately network-independent, so this works in CI whether or
not the Aviation Weather Center is reachable: with nothing configured the app
draws its own "NO REPORT" state, which is still a running app.

    python3 tools/verify-screenshot.py shot.png
    python3 tools/verify-screenshot.py shot.png --width 200 --height 228
"""

import argparse
import struct
import sys
import zlib


def read_png(path):
    """Decode a PNG to (width, height, rows of RGB tuples). No dependencies."""
    data = open(path, "rb").read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")

    pos, idat, width, height, depth, color = 8, b"", 0, 0, 0, 0
    palette = None
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos:pos + 4])
        kind = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + length]
        if kind == b"IHDR":
            width, height, depth, color = struct.unpack(">IIBB", chunk[:10])
        elif kind == b"PLTE":
            palette = chunk
        elif kind == b"IDAT":
            idat += chunk
        pos += 12 + length

    if depth != 8 or color not in (2, 6):
        raise ValueError("expected 8-bit RGB or RGBA, got depth=%d color=%d" % (depth, color))

    channels = 4 if color == 6 else 3
    stride = width * channels
    raw = zlib.decompress(idat)

    rows, prev, i = [], bytearray(stride), 0
    for _ in range(height):
        filter_type = raw[i]
        i += 1
        line = bytearray(raw[i:i + stride])
        i += stride
        for x in range(stride):
            a = line[x - channels] if x >= channels else 0
            b = prev[x]
            c = prev[x - channels] if x >= channels else 0
            if filter_type == 1:
                line[x] = (line[x] + a) & 0xFF
            elif filter_type == 2:
                line[x] = (line[x] + b) & 0xFF
            elif filter_type == 3:
                line[x] = (line[x] + (a + b) // 2) & 0xFF
            elif filter_type == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pred = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pred) & 0xFF
        rows.append([tuple(line[x * channels:x * channels + 3]) for x in range(width)])
        prev = line
    return width, height, rows


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("path")
    p.add_argument("--width", type=int, default=200, help="expected width (emery is 200)")
    p.add_argument("--height", type=int, default=228, help="expected height (emery is 228)")
    p.add_argument("--min-ink", type=float, default=0.5,
                   help="minimum %% of non-background pixels for the frame to count as drawn")
    args = p.parse_args()

    try:
        width, height, rows = read_png(args.path)
    except Exception as e:  # noqa: BLE001 -- any decode failure is a failure
        sys.exit("FAIL: could not read %s: %s" % (args.path, e))

    problems = []

    if (width, height) != (args.width, args.height):
        problems.append("expected %dx%d, got %dx%d"
                        % (args.width, args.height, width, height))

    # A crashed or never-started app leaves the frame empty.  A running one has
    # drawn a header, a rule and some text, so a measurable share of the pixels
    # are not the background.
    ink = sum(1 for row in rows for px in row if px != (0, 0, 0))
    ink_pct = 100.0 * ink / max(1, width * height)
    if ink_pct < args.min_ink:
        problems.append("only %.2f%% of pixels are drawn (want >= %.2f%%); "
                        "the app probably did not render"
                        % (ink_pct, args.min_ink))

    # An all-one-colour frame is a fill, not a UI.
    distinct = {px for row in rows for px in row}
    if len(distinct) < 3:
        problems.append("only %d distinct colours; expected text and chrome"
                        % len(distinct))

    if problems:
        for problem in problems:
            print("FAIL: %s" % problem, file=sys.stderr)
        sys.exit(1)

    print("ok: %dx%d, %.1f%% drawn, %d distinct colours" % (width, height, ink_pct, len(distinct)))


if __name__ == "__main__":
    main()
