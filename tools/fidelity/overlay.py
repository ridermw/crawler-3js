#!/usr/bin/env python3
"""Geometry overlay: reference clay pass vs runtime clay capture.

Both images are reduced to the scored 3:2 overlap (the runtime is centre-cropped exactly as
compare-scene.py does), converted to soft edge maps and composited: reference edges in red,
runtime edges in cyan, agreement in white. Also prints a per-cell edge-correlation table so
layout drift can be located without guessing.

    python3 tools/fidelity/overlay.py artifacts/image-run/crypt/clay.png \
        artifacts/validation/tmp/ashen-reliquary-crypt-clay.png --out overlay.jpg
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image

try:
    import cv2
except ModuleNotFoundError:  # pragma: no cover
    print("overlay.py requires OpenCV (pip install opencv-python-headless)", file=sys.stderr)
    raise SystemExit(2)

W, H = 1200, 800


def load(path: Path, crop_to_3x2: bool) -> np.ndarray:
    im = Image.open(path).convert("L")
    if crop_to_3x2 and abs(im.width / im.height - 1.5) > 0.01:
        cw = round(im.height * 1.5)
        left = (im.width - cw) // 2
        im = im.crop((left, 0, left + cw, im.height))
    return np.array(im.resize((W, H), Image.Resampling.LANCZOS))


def soft_edges(g: np.ndarray) -> np.ndarray:
    g = cv2.GaussianBlur(g, (0, 0), 1.6)
    g = cv2.normalize(g, None, 0, 255, cv2.NORM_MINMAX)
    e = cv2.Canny(g, 30, 80).astype(np.float32) / 255.0
    return cv2.GaussianBlur(e, (0, 0), 1.2)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("reference", type=Path)
    ap.add_argument("runtime", type=Path)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--grid", default="6x4")
    a = ap.parse_args()
    ref, run = load(a.reference, False), load(a.runtime, True)
    er, eu = soft_edges(ref), soft_edges(run)
    base = (0.25 * (ref.astype(np.float32) + run.astype(np.float32)) / 2).astype(np.float32)
    rgb = np.stack([base, base, base], -1)
    rgb[..., 0] += er * 255
    rgb[..., 1] += eu * 255
    rgb[..., 2] += eu * 255
    out = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8))
    cols, rows = (int(v) for v in a.grid.split("x"))
    from PIL import ImageDraw
    d = ImageDraw.Draw(out)
    for c in range(1, cols):
        d.line([(c * W // cols, 0), (c * W // cols, H)], fill=(110, 110, 0))
    for r in range(1, rows):
        d.line([(0, r * H // rows), (W, r * H // rows)], fill=(110, 110, 0))
    a.out.parent.mkdir(parents=True, exist_ok=True)
    out.save(a.out, quality=88)
    print("edge correlation per cell (100 = identical layout):")
    total = []
    for r in range(rows):
        line = []
        for c in range(cols):
            sl = (slice(r * H // rows, (r + 1) * H // rows), slice(c * W // cols, (c + 1) * W // cols))
            x, y = er[sl].ravel(), eu[sl].ravel()
            cc = float(np.corrcoef(x, y)[0, 1]) if x.std() > 1e-6 and y.std() > 1e-6 else 0.0
            line.append(cc * 100)
            total.append(cc * 100)
        print("  " + " ".join(f"{v:6.1f}" for v in line))
    print(f"mean {np.mean(total):.1f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
