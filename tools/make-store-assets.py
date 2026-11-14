#!/usr/bin/env python3
"""
Generate the app store images:

    store/icon-small-80.png     80 x 80   (store "small icon")
    store/icon-large-144.png    144 x 144 (store "large icon")
    store/banner-720x320.png    720 x 320 (listing banner)

    python3 tools/make-store-assets.py

The icons are the launcher icon's windsock (tools/make-icon.py), drawn again
at store size and in colour: the launcher only keeps an icon's luminance, but
the store shows colour, so the sock gets the orange and white bands a real one
has.  The banner puts two screenshots next to the app's name: the Home and TAF
pages from store/banner/, captured with
`sh tools/capture-store-screenshots.sh --banner KLAX`.

Needs Pillow (`pip install pillow`) for drawing and text.  Nothing here is
used at runtime.
"""

import glob
import os
import sys

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.exit("needs Pillow: pip install pillow")

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORE = os.path.join(HERE, "store")

NAVY = (14, 26, 43)
NAVY_LIGHT = (28, 46, 72)
ORANGE = (255, 120, 20)
WHITE = (245, 245, 245)
GREY = (150, 162, 178)
POLE = (200, 205, 212)

FONT_DIRS = ["/usr/share/fonts/truetype/dejavu", "/usr/share/fonts/dejavu",
             "/Library/Fonts", "/System/Library/Fonts/Supplemental"]


def font(name, size):
    for d in FONT_DIRS:
        path = os.path.join(d, name)
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    sys.exit("font %s not found; install fonts-dejavu" % name)


def windsock(size, background=True):
    """The windsock on a rounded navy square, drawn 4x and scaled down so the
    edges are smooth."""
    s = size * 4
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if background:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=s // 5, fill=NAVY)

    u = s / 25.0  # the 25 px launcher grid, so the shape matches make-icon.py
    # Pole and foot.
    d.rectangle([4.0 * u, 3.0 * u, 5.4 * u, 21.5 * u], fill=POLE)
    d.rectangle([2.6 * u, 20.6 * u, 6.8 * u, 21.6 * u], fill=POLE)

    # Sock: a tapering quadrilateral from the pole to the free end, cut into
    # five bands that alternate orange and white.
    x0, x1 = 5.4 * u, 22.0 * u
    mouth_top, mouth_bot = 4.4 * u, 11.6 * u
    tip_top, tip_bot = 7.2 * u, 9.6 * u
    bands = 5
    for i in range(bands):
        t0, t1 = i / float(bands), (i + 1) / float(bands)
        xa, xb = x0 + (x1 - x0) * t0, x0 + (x1 - x0) * t1
        ta = mouth_top + (tip_top - mouth_top) * t0
        tb = mouth_top + (tip_top - mouth_top) * t1
        ba = mouth_bot + (tip_bot - mouth_bot) * t0
        bb = mouth_bot + (tip_bot - mouth_bot) * t1
        d.polygon([(xa, ta), (xb, tb), (xb, bb), (xa, ba)],
                  fill=ORANGE if i % 2 == 0 else WHITE)

    # A wind line under the sock, so it reads as weather and not a flag.
    d.line([(9.0 * u, 15.6 * u), (21.0 * u, 15.6 * u)], fill=GREY, width=int(1.1 * u))
    d.line([(12.0 * u, 18.2 * u), (21.0 * u, 18.2 * u)], fill=GREY, width=int(1.1 * u))
    return im.resize((size, size), Image.LANCZOS)


def framed(shot, pad=10, radius=22):
    """A screenshot in a plain dark bezel.  The banner may be framed; the
    screenshots uploaded on their own must not be."""
    w, h = shot.size
    im = Image.new("RGBA", (w + 2 * pad, h + 2 * pad), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, w + 2 * pad - 1, h + 2 * pad - 1], radius=radius,
                        fill=(8, 10, 14), outline=(70, 80, 95), width=2)
    im.paste(shot, (pad, pad))
    return im


def banner(shots):
    """Name and one line on the left; two screenshots side by side on the
    right, neither covering the other -- the values are the point."""
    W, H = 720, 320
    im = Image.new("RGB", (W, H), NAVY)
    d = ImageDraw.Draw(im)
    d.rectangle([250, 0, W, H], fill=NAVY_LIGHT)

    icon = windsock(56, background=False)
    im.paste(icon, (26, 40), icon)

    title = font("DejaVuSans-Bold.ttf", 36)
    sub = font("DejaVuSans.ttf", 16)
    d.text((26, 108), "Airport", font=title, fill=WHITE)
    d.text((26, 150), "Wx", font=title, fill=WHITE)
    d.text((26, 206), "METAR and TAF for", font=sub, fill=GREY)
    d.text((26, 228), "your airports", font=sub, fill=GREY)

    x = 264
    for shot in shots:
        f = framed(shot.convert("RGB"), pad=8, radius=18)
        im.paste(f, (x, (H - f.size[1]) // 2), f)
        x += f.size[0] + 14
    return im


def main():
    os.makedirs(STORE, exist_ok=True)
    for size, name in ((80, "icon-small-80.png"), (144, "icon-large-144.png")):
        path = os.path.join(STORE, name)
        windsock(size).save(path)
        print("wrote store/%s" % name)

    banner_dir = os.path.join(STORE, "banner")
    shots = [os.path.join(banner_dir, n) for n in ("home.png", "taf.png")]
    missing = [p for p in shots if not os.path.exists(p)]
    if missing:
        sys.exit("missing %s -- run: sh tools/capture-store-screenshots.sh --banner KLAX"
                 % ", ".join(os.path.relpath(p, HERE) for p in missing))
    chosen = [Image.open(p) for p in shots]
    path = os.path.join(STORE, "banner-720x320.png")
    banner(chosen).save(path)
    print("wrote store/banner-720x320.png")


if __name__ == "__main__":
    main()
