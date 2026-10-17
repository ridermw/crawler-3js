#!/usr/bin/env python3
"""Blockout score: how well the runtime clay render matches the reference clay pass in large-scale
form, ignoring surface detail (cracks, seams, debris).

Both images are reduced to the scored 3:2 frame, normalised, and compared at two coarse scales:
shading (Gaussian sigma 6 px at 600x400, correlation) and silhouette edges (gradient magnitude of
the sigma 4 image, correlation). Prints an overall score (0-100) and a 6x4 per-cell table so the
worst regions are obvious.

    python3 tools/fidelity/claymatch.py artifacts/validation/tmp/ashen-reliquary-crypt-clay.png
"""
import sys
from pathlib import Path
import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
W, H = 600, 400


def load(path, crop):
    im = Image.open(path).convert("L")
    if crop and abs(im.width / im.height - 1.5) > 0.01:
        cw = round(im.height * 1.5); left = (im.width - cw) // 2
        im = im.crop((left, 0, left + cw, im.height))
    g = np.array(im.resize((W, H), Image.Resampling.LANCZOS)).astype(np.float32)
    return (g - g.mean()) / (g.std() + 1e-6)


def feats(g):
    lum = cv2.GaussianBlur(g, (0, 0), 6)
    s = cv2.GaussianBlur(g, (0, 0), 4)
    edge = cv2.GaussianBlur(np.hypot(cv2.Sobel(s, cv2.CV_32F, 1, 0), cv2.Sobel(s, cv2.CV_32F, 0, 1)), (0, 0), 3)
    return lum, edge


def corr(a, b):
    a = a.ravel() - a.mean(); b = b.ravel() - b.mean()
    return float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))


def main():
    run = sys.argv[1]
    ref = sys.argv[2] if len(sys.argv) > 2 else ROOT / "artifacts/image-run/crypt/clay.png"
    (lr, er), (lu, eu) = feats(load(ref, False)), feats(load(run, True))
    total = 50 * (corr(lr, lu) + corr(er, eu))
    print(f"blockout score {total:.1f}  (shading {100 * corr(lr, lu):.1f}, silhouette {100 * corr(er, eu):.1f})")
    for r in range(4):
        row = []
        for c in range(6):
            sl = (slice(r * H // 4, (r + 1) * H // 4), slice(c * W // 6, (c + 1) * W // 6))
            row.append(50 * (corr(lr[sl], lu[sl]) + corr(er[sl], eu[sl])))
        print("  " + " ".join(f"{v:6.1f}" for v in row))


if __name__ == "__main__":
    main()
