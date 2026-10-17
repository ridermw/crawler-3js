#!/usr/bin/env python3
"""Top-down height plan of the reference and runtime rooms, reconstructed from depth.

Every pixel of each depth map is projected to its world point through the fitted crypt camera and
splatted into an XZ grid (0.1 m cells) keeping the highest point. Reference left, runtime right,
with a 1 m grid; colour is height above the floor.

    python3 tools/fidelity/plan.py run.f32 --out plan.png [--npy refplan.npy]
"""
import argparse, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, str(Path(__file__).parent))
import refcam as rc
from depthdiff import ref_depth_metres, heat, ELEV, W, H

X0, X1, Z0, Z1, CELL = -15.0, 15.0, -12.0, 15.0, 0.1


def plan(depth):
    P = rc.EYE + rc.rays(W, H) * depth[..., None]
    ok = np.isfinite(P).all(-1) & (depth < 200)
    ix = ((P[..., 0] - X0) / CELL).astype(int); iz = ((P[..., 2] - Z0) / CELL).astype(int)
    nx, nz = int((X1 - X0) / CELL), int((Z1 - Z0) / CELL)
    ok &= (ix >= 0) & (ix < nx) & (iz >= 0) & (iz < nz)
    g = np.full((nz, nx), np.nan)
    flat = iz[ok] * nx + ix[ok]; y = P[..., 1][ok]
    order = np.argsort(y); out = g.ravel(); out[flat[order]] = y[order]
    return out.reshape(nz, nx)


def draw(g, title):
    im = heat(np.nan_to_num(g, nan=-9), -1.5, 7, ELEV)
    im[np.isnan(g)] = (25, 25, 25)
    img = Image.fromarray(im).resize((g.shape[1] * 2, g.shape[0] * 2), Image.NEAREST)
    d = ImageDraw.Draw(img)
    for x in range(int(X0), int(X1) + 1):
        px = (x - X0) / CELL * 2; d.line([(px, 0), (px, img.height)], fill=(90, 90, 90) if x % 5 else (200, 200, 200))
        if x % 5 == 0: d.text((px + 2, 2), str(x), fill=(255, 255, 0))
    for z in range(int(Z0), int(Z1) + 1):
        pz = (z - Z0) / CELL * 2; d.line([(0, pz), (img.width, pz)], fill=(90, 90, 90) if z % 5 else (200, 200, 200))
        if z % 5 == 0: d.text((2, pz + 2), str(z), fill=(255, 255, 0))
    d.text((8, img.height - 16), title, fill=(255, 255, 255))
    return img


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("runtime"); ap.add_argument("--out", required=True); ap.add_argument("--npy"); ap.add_argument("--ref", help="refined reference depth .npy (metres)")
    a = ap.parse_args()
    dref = np.load(a.ref).astype(float) if a.ref else ref_depth_metres()[0]
    pr = plan(dref)
    pu = plan(np.fromfile(a.runtime, np.float32).reshape(H, W).astype(float))
    if a.npy: np.save(a.npy, pr)
    A, B = draw(pr, "reference (from depth pass)"), draw(pu, "runtime")
    s = Image.new("RGB", (A.width * 2 + 10, A.height), (0, 0, 0)); s.paste(A, (0, 0)); s.paste(B, (A.width + 10, 0)); s.save(a.out)
