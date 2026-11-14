#!/usr/bin/env python3
"""
Seed the emulator's PebbleKit JS localStorage with app settings.

The Clay settings page needs a browser, which a headless emulator does not
have.  This writes the same object the app itself stores on `webviewclosed`
straight into the emulator's localStorage, so a screenshot or a smoke test can
start from a configured app.

    pebble kill
    python3 tools/emu-settings.py --home KRDU --also KBOS --also KASE
    pebble install --emulator emery

Nothing here is used at runtime; it is a development convenience only.
"""

import argparse
import dbm.dumb
import json
import os
import sys

STORAGE_KEY = "avwx-settings"


def default_persist():
    """The emulator keeps its state per SDK version, so follow the active SDK
    rather than naming one that goes stale on the next upgrade."""
    root = os.path.expanduser("~/.local/share/pebble-sdk")
    current = os.path.join(root, "SDKs", "current")
    version = os.path.basename(os.path.realpath(current)) if os.path.exists(current) else ""
    return os.path.join(root, version, "emery")


def app_uuid(project_root):
    with open(os.path.join(project_root, "package.json")) as f:
        return json.load(f)["pebble"]["uuid"]


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--home", default="KRDU", help="home airport ICAO")
    p.add_argument("--also", action="append", default=[],
                   help="additional station, repeatable (up to 4)")
    p.add_argument("--persist", default=default_persist(),
                   help="emulator persist directory")
    p.add_argument("--set", action="append", default=[], metavar="KEY=VALUE",
                   help="any other setting, e.g. --set tempUnit=c")
    args = p.parse_args()

    settings = {"homeStation": args.home.upper()}
    for i, station in enumerate(args.also[:4], start=2):
        settings["station%d" % i] = station.upper()
    for pair in args.set:
        key, _, value = pair.partition("=")
        if value in ("true", "false"):
            settings[key] = value == "true"
        elif value.lstrip("-").isdigit():
            settings[key] = int(value)
        else:
            settings[key] = value

    store_dir = os.path.join(args.persist, "localstorage")
    if not os.path.isdir(store_dir):
        sys.exit("no emulator localstorage at %s -- has the emulator ever run?" % store_dir)

    path = os.path.join(store_dir, app_uuid(root))
    with dbm.dumb.open(path, "c") as db:
        db[STORAGE_KEY.encode()] = json.dumps(settings).encode()

    print("seeded %s:\n  %s" % (path, json.dumps(settings)))


if __name__ == "__main__":
    main()
