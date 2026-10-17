#!/usr/bin/env python3
"""Sharpen the reference depth with the reference clay pass.

The depth pass gives distances but blurred edges; the clay pass gives crisp edges. Clay edges cut
the frame into regions; inside each region inverse depth is fitted as a plane in pixel coordinates
(exact for any planar surface under perspective) with outlier trimming. Regions that are not
planar (rubble, bones, chains) keep a clay-guided filtered depth instead. Output: metres, float32.

    python3 tools/fidelity/refdepth.py --out refdepth.npy --preview refdepth.png
"""
import argparse, sys
from pathlib import Path
import cv2, numpy as np
from PIL import Image
sys.path.insert(0, str(Path(__file__).parent))
from depthdiff import ref_depth_metres, W, H, heat, ELEV
import refcam as rc

ROOT = Path(__file__).resolve().parents[2]


def guided(I, p, r, eps):
    k = (2 * r + 1, 2 * r + 1)
    mI, mp = cv2.blur(I, k), cv2.blur(p, k)
    a = (cv2.blur(I * p, k) - mI * mp) / (cv2.blur(I * I, k) - mI * mI + eps)
    b = mp - a * mI
    return cv2.blur(a, k) * I + cv2.blur(b, k)


def refine():
    d0, _ = ref_depth_metres()
    clay = np.array(Image.open(ROOT / "artifacts/image-run/crypt/clay.png").convert("L").resize((W, H), Image.Resampling.LANCZOS)).astype(np.float32) / 255
    dg = guided(clay, d0.astype(np.float32), 4, 1e-3)
    e = cv2.Canny((clay * 255).astype(np.uint8), 18, 50)
    e = cv2.dilate(e, np.ones((2, 2), np.uint8))
    n, lab = cv2.connectedComponents((e == 0).astype(np.uint8), connectivity=4)
    vv, uu = np.mgrid[0:H, 0:W].astype(np.float64)
    out = dg.astype(np.float64).copy(); planar = np.zeros((H, W), bool)
    inv = 1.0 / d0
    for k in range(1, n):
        m = lab == k; c = int(m.sum())
        if c < 60: continue
        A = np.stack([uu[m], vv[m], np.ones(c)], 1); y = inv[m]
        coef, *_ = np.linalg.lstsq(A, y, rcond=None)
        for _ in range(2):
            res = y - A @ coef; keep = np.abs(res) < 2.0 * res.std() + 1e-9
            coef, *_ = np.linalg.lstsq(A[keep], y[keep], rcond=None)
        fit = 1.0 / (A @ coef); rel = np.median(np.abs(fit - d0[m]) / d0[m])
        if rel < 0.012:
            out[m] = fit; planar[m] = True
    # edge pixels: nearest planar neighbour value (so discontinuities stay sharp)
    edge = lab == 0
    if edge.any():
        src = np.where(planar, 0, 1).astype(np.uint8)
        _, idx = cv2.distanceTransformWithLabels(src, cv2.DIST_L2, 3, labelType=cv2.DIST_LABEL_PIXEL)
        ys, xs = np.nonzero(planar); lut = np.zeros(idx.max() + 1, int); lut[idx[planar]] = np.arange(len(ys))
        j = lut[idx[edge]]; out[edge] = out[ys[j], xs[j]]
    return out.astype(np.float32), planar, lab


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--out", required=True); ap.add_argument("--preview"); ap.add_argument("--mode", default="guided", choices=["guided", "planar"])
    a = ap.parse_args()
    d, planar, lab = refine()
    if a.mode == 'guided':
        d0, _ = ref_depth_metres(); clay = np.array(Image.open(ROOT / 'artifacts/image-run/crypt/clay.png').convert('L').resize((W, H), Image.Resampling.LANCZOS)).astype(np.float32) / 255
        d = guided(clay, d0.astype(np.float32), 3, 4e-4).astype(np.float32)
    np.save(a.out, d)
    print(f"planar coverage {100 * planar.mean():.1f}%  regions {lab.max()}")
    if a.preview:
        P = rc.EYE + rc.rays(W, H) * d[..., None]
        Image.fromarray(heat(P[..., 1], -1.5, 7, ELEV)).save(a.preview)
