#!/usr/bin/env python3
"""Measure the reference room from the clay pass through the fitted crypt camera.

Each item is a name with a base pixel (where a vertical face meets the floor, or a point on a
surface at known height --y) and optional top pixels on the same vertical. Output: world x, z and
the height of each top point above the base. Pixels are in the 1536x1024 reference frame.

    python3 tools/fidelity/measure.py 'altar:768,268:768,140' 'pierL:300,380:300,250'
    python3 tools/fidelity/measure.py --y 0.5 'ledge:250,170'
    python3 tools/fidelity/measure.py --sheet x0,y0,x1,y1 --out crop.png   # gridded clay crop for picking
"""
import argparse, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, str(Path(__file__).parent))
import refcam as rc

ROOT = Path(__file__).resolve().parents[2]


def ray(u, v):
    d = rc.FWD * rc.F + rc.RIGHT * (u - rc.W / 2) - rc.UP * (v - rc.H / 2)
    return d / np.linalg.norm(d)


def on_plane_y(u, v, y):
    r = ray(u, v); t = (y - rc.EYE[1]) / r[1]; return rc.EYE + r * t


def height_above(base, u, v):
    """Height of pixel (u, v) on the vertical line through world point `base`."""
    r = ray(u, v); e = rc.EYE
    # closest point between the camera ray and the vertical line x=base.x, z=base.z
    w = np.array([base[0] - e[0], 0, base[2] - e[2]])
    t = (w @ np.array([r[0], 0, r[2]])) / (r[0] ** 2 + r[2] ** 2)
    return (e + r * t)[1]


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("items", nargs="*"); ap.add_argument("--y", type=float, default=0.0)
    ap.add_argument("--sheet"); ap.add_argument("--out"); ap.add_argument("--pass", dest="ps", default="clay"); ap.add_argument("--step", type=int, default=16)
    a = ap.parse_args()
    if a.sheet:
        x0, y0, x1, y1 = (int(v) for v in a.sheet.split(","))
        im = Image.open(ROOT / f"artifacts/image-run/crypt/{a.ps}.png").convert("RGB").resize((rc.W, rc.H), Image.Resampling.LANCZOS).crop((x0, y0, x1, y1))
        k = max(1, int(1400 / im.width)); im = im.resize((im.width * k, im.height * k), Image.Resampling.LANCZOS)
        d = ImageDraw.Draw(im, "RGBA")
        for x in range((x0 // a.step + 1) * a.step, x1, a.step):
            d.line([((x - x0) * k, 0), ((x - x0) * k, im.height)], fill=(255, 0, 0, 200 if x % (a.step * 4) == 0 else 70))
            if x % (a.step * 4) == 0: d.text(((x - x0) * k + 2, 2), str(x), fill=(255, 0, 0, 255))
        for y in range((y0 // a.step + 1) * a.step, y1, a.step):
            d.line([(0, (y - y0) * k), (im.width, (y - y0) * k)], fill=(0, 140, 255, 200 if y % (a.step * 4) == 0 else 70))
            if y % (a.step * 4) == 0: d.text((2, (y - y0) * k + 2), str(y), fill=(0, 140, 255, 255))
        im.save(a.out); return
    for it in a.items:
        name, base, *tops = it.split(":")
        u, v = (float(t) for t in base.split(","))
        p = on_plane_y(u, v, a.y)
        hs = [height_above(p, *(float(t) for t in tp.split(","))) for tp in tops]
        print(f"{name:14s} x={p[0]:7.2f} z={p[2]:7.2f}" + "".join(f"  top{i + 1}={h:5.2f}m" for i, h in enumerate(hs)))


if __name__ == "__main__":
    main()
