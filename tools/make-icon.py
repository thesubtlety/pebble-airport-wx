#!/usr/bin/env python3
"""
Generate the 25x25 launcher icon: resources/images/menu-icon.png.

    python3 tools/make-icon.py            # write the PNG
    python3 tools/make-icon.py --preview  # draw it as text and write nothing

Why a windsock: the launcher renders a menu icon by its *luminance*, keeping
transparency, so whatever is drawn here ends up a flat silhouette.  That rules
out anything relying on colour, and rules out fine detail at 25 px.  A windsock
is the one aviation-weather symbol that survives both -- it is unmistakable in
outline, it is what an airfield actually uses to show wind, and wind is the
app's first row.  A cloud would say "weather" without saying "aviation"; a
compass rose would say "navigation".

The shape is computed rather than hand-plotted so the taper stays smooth, and
`--preview` prints it as text so a change can be judged in a terminal before
anyone opens an image viewer.

The white windsock has a one-pixel black outline.  The phone app shows a
sideloaded app's launcher icon as it is, on a white list, where a white
silhouette alone is invisible.  The outline gives it an edge there.  On the
watch launcher the outline shows as a dark edge, and the icon reads on both
the highlighted and the plain row (docs/screenshots/11-launcher.png).

25 x 25 is the maximum the SDK accepts; larger icons are rejected outright.
"""

import argparse
import os
import struct
import zlib

SIZE = 25

# Pole
POLE_X0, POLE_X1 = 2, 3
POLE_Y0, POLE_Y1 = 2, 22
FOOT_Y0, FOOT_Y1 = 21, 22
FOOT_X0, FOOT_X1 = 0, 6

# Sock: wide where it meets the pole, tapering hard to the free end.  The
# taper has to be pronounced -- a gentle one reads as a rectangle at this size.
SOCK_X0, SOCK_X1 = 4, 23
SOCK_MOUTH_TOP, SOCK_MOUTH_BOT = 4, 14   # height at the pole
SOCK_TIP_TOP, SOCK_TIP_BOT = 9, 11       # height at the free end
# Transparent bands, which read as the stripes on a real sock.  One pixel wide,
# not two: at 25 px a wider gap severs the silhouette into separate blobs.
STRIPES = ((8, 8), (12, 12), (16, 16), (20, 20))


def build_mask():
    """True where the icon is opaque."""
    mask = [[False] * SIZE for _ in range(SIZE)]

    for y in range(POLE_Y0, POLE_Y1 + 1):
        for x in range(POLE_X0, POLE_X1 + 1):
            mask[y][x] = True
    for y in range(FOOT_Y0, FOOT_Y1 + 1):
        for x in range(FOOT_X0, FOOT_X1 + 1):
            mask[y][x] = True

    span = SOCK_X1 - SOCK_X0
    for x in range(SOCK_X0, SOCK_X1 + 1):
        t = (x - SOCK_X0) / float(span)
        top = SOCK_MOUTH_TOP + (SOCK_TIP_TOP - SOCK_MOUTH_TOP) * t
        bot = SOCK_MOUTH_BOT + (SOCK_TIP_BOT - SOCK_MOUTH_BOT) * t
        if any(a <= x <= b for a, b in STRIPES):
            continue
        for y in range(int(round(top)), int(round(bot)) + 1):
            if 0 <= y < SIZE:
                mask[y][x] = True

    return mask


def outline_of(mask):
    """Transparent pixels that touch the shape, including diagonally."""
    edge = [[False] * SIZE for _ in range(SIZE)]
    for y in range(SIZE):
        for x in range(SIZE):
            if mask[y][x]:
                continue
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < SIZE and 0 <= nx < SIZE and mask[ny][nx]:
                        edge[y][x] = True
    return edge


def write_png(path, mask):
    """Greyscale + alpha: white where drawn, black on the outline, fully
    transparent elsewhere."""
    edge = outline_of(mask)
    raw = b""
    for y, row in enumerate(mask):
        line = bytearray([0])  # filter type 0
        for x, on in enumerate(row):
            if on:
                line += bytes((255, 255))
            elif edge[y][x]:
                line += bytes((0, 255))
            else:
                line += bytes((0, 0))
        raw += bytes(line)

    def chunk(kind, data):
        return (struct.pack(">I", len(data)) + kind + data
                + struct.pack(">I", zlib.crc32(kind + data)))

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 4, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))

    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(png)
    return len(png)


def preview(mask):
    print("+" + "-" * SIZE + "+")
    for row in mask:
        print("|" + "".join("#" if on else " " for on in row) + "|")
    print("+" + "-" * SIZE + "+")


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--preview", action="store_true", help="print as text, write nothing")
    args = p.parse_args()

    mask = build_mask()
    preview(mask)
    if args.preview:
        return

    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = os.path.join(here, "resources", "images", "menu-icon.png")
    size = write_png(out, mask)
    opaque = sum(1 for row in mask for on in row if on)
    print("wrote %s (%d bytes, %dx%d, %d opaque px)"
          % (os.path.relpath(out, here), size, SIZE, SIZE, opaque))


if __name__ == "__main__":
    main()
