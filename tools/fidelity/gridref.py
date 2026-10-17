#!/usr/bin/env python3
"""Draw the projected runtime world grid (from gridproject.mjs) over a reference pass.

    python3 tools/fidelity/gridref.py artifacts/image-run/crypt/clay.png grid.json --out ref-grid.jpg

Grid lines every metre (labelled every 2 m) show where each reference object sits in runtime world
coordinates; magenta crosses mark the runtime's current landmark positions for comparison.
"""
import argparse, json
from PIL import Image, ImageDraw

ap = argparse.ArgumentParser()
ap.add_argument("reference"); ap.add_argument("grid"); ap.add_argument("--out", required=True)
ap.add_argument("--crop", help="x0,y0,x1,y1 in 1536x1024 reference pixels"); ap.add_argument("--scale", type=float, default=1.0)
a = ap.parse_args()
im = Image.open(a.reference).convert("RGB").resize((1536, 1024))
d = ImageDraw.Draw(im, "RGBA")
g = json.load(open(a.grid))
for ln in g["lines"]:
    major = ln["v"] % 2 == 0
    col = (255, 60, 60, 150) if ln["axis"] == "x" else (60, 160, 255, 150)
    if ln["v"] == 0: col = (255, 255, 0, 220)
    d.line([tuple(p) for p in ln["pts"]], fill=col, width=2 if major else 1)
    if major:
        for p in ln["pts"][::8]:
            if 0 <= p[0] < 1536 and 0 <= p[1] < 1024:
                d.text((p[0] + 2, p[1] + 1), f"{ln['axis']}{ln['v']}", fill=col[:3] + (255,))
                break
for l in g["landmarks"]:
    x, y = l["p"]; d.line([(x - 8, y), (x + 8, y)], fill=(255, 0, 255, 255), width=2); d.line([(x, y - 8), (x, y + 8)], fill=(255, 0, 255, 255), width=2)
    d.text((x + 6, y - 14), l["name"], fill=(255, 0, 255, 255))
if a.crop:
    im = im.crop(tuple(int(v) for v in a.crop.split(",")))
if a.scale != 1:
    im = im.resize((int(im.width * a.scale), int(im.height * a.scale)))
im.save(a.out, quality=90)
