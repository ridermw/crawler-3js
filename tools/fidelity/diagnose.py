#!/usr/bin/env python3
"""Per-cell diagnostics for the v2 scene metrics: where edges are missing or excessive at the
gate's pre-smoothed scales, and where luminance/chroma diverge.

    python3 tools/fidelity/diagnose.py --screen crypt [--runtime PATH]
"""
from __future__ import annotations

import argparse
import importlib.util
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent.parent
spec = importlib.util.spec_from_file_location("compare_scene", ROOT / "tools/fidelity/compare-scene.py")
cs = importlib.util.module_from_spec(spec); sys.modules["compare_scene"] = cs; spec.loader.exec_module(cs)
REF = {"title": "ashen-reliquary-title", "settings": "ashen-reliquary-settings", "crypt": "ashen-reliquary"}


def table(title, a, b, fmt="{:6.1f}", rows=4, cols=6, ratio=False):
    print(title)
    for r in range(rows):
        cells = []
        for c in range(cols):
            x, y = a[r][c], b[r][c]
            cells.append(("{:5.0f}%".format(100 * y / x) if x > 1e-9 else "   n/a") if ratio else (fmt.format(x) + "/" + fmt.format(y).strip()))
        print("  " + "  ".join(cells))


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--screen", required=True); ap.add_argument("--runtime", type=Path)
    a = ap.parse_args()
    ref = ROOT / "artifacts/mockups" / f"{REF[a.screen]}.png"
    run = a.runtime or ROOT / f"artifacts/validation/ashen-reliquary-{a.screen}-runtime.png"
    rep, R, U, mask = cs.evaluate_screen(a.screen, ref, run)
    s = rep["scene"]
    print({k: round(v, 1) for k, v in s.items() if isinstance(v, float)})
    gR, gU = cv2.cvtColor(R, cv2.COLOR_RGB2GRAY), cv2.cvtColor(U, cv2.COLOR_RGB2GRAY)
    e1R, e2R = cs.multiscale_edges(gR, mask); e1U, e2U = cs.multiscale_edges(gU, mask)
    H, W = mask.shape
    def grid(f):
        return [[f(slice(r * H // 4, (r + 1) * H // 4), slice(c * W // 6, (c + 1) * W // 6)) for c in range(6)] for r in range(4)]
    dens = lambda e: grid(lambda ys, xs: float(e[ys, xs][mask[ys, xs]].mean()) if mask[ys, xs].any() else 0.0)
    table("edge density sigma2, runtime as % of reference", dens(e1R), dens(e1U), ratio=True)
    table("edge density sigma3.5, runtime as % of reference", dens(e2R), dens(e2U), ratio=True)
    print(f"totals s2 ref={e1R[mask].mean():.4f} run={e1U[mask].mean():.4f}  s3.5 ref={e2R[mask].mean():.4f} run={e2U[mask].mean():.4f}")
    # HOG gradient mass per 6x4 cell (share of total, runtime as % of reference) and per-cell
    # orientation-histogram similarity; coarse SSIM averaged per cell.
    def hog_cells(g):
        f = cv2.GaussianBlur(g.astype(np.float32), (0, 0), 2.2)
        gx, gy = cv2.Sobel(f, cv2.CV_32F, 1, 0, ksize=3), cv2.Sobel(f, cv2.CV_32F, 0, 1, ksize=3)
        mag = np.maximum(0, np.hypot(gx, gy) - 12) * mask; b = np.clip(((np.arctan2(gy, gx) % np.pi) / np.pi * 8).astype(int), 0, 7)
        return grid(lambda ys, xs: np.bincount(b[ys, xs].ravel(), weights=mag[ys, xs].ravel(), minlength=8))
    hR, hU = hog_cells(gR), hog_cells(gU)
    tR, tU = sum(h.sum() for row in hR for h in row), sum(h.sum() for row in hU for h in row)
    table("HOG gradient mass share, runtime as % of reference", [[h.sum() / tR for h in row] for row in hR], [[h.sum() / tU for h in row] for row in hU], ratio=True)
    sim = lambda a, b: 100 * (1 - 0.5 * np.abs(a / max(a.sum(), 1e-9) - b / max(b.sum(), 1e-9)).sum())
    print("HOG orientation similarity per cell (shape only)")
    for r in range(4): print("  " + "  ".join(f"{sim(hR[r][c], hU[r][c]):5.0f} " for c in range(6)))
    g1 = cv2.resize(cv2.GaussianBlur(gR.astype(np.float32), (0, 0), 3.5), (135, 90), interpolation=cv2.INTER_AREA)
    g2 = cv2.resize(cv2.GaussianBlur(gU.astype(np.float32), (0, 0), 3.5), (135, 90), interpolation=cv2.INTER_AREA)
    c2 = (0.03 * 255) ** 2; mu1, mu2 = cv2.GaussianBlur(g1, (7, 7), 1.5), cv2.GaussianBlur(g2, (7, 7), 1.5)
    s11 = cv2.GaussianBlur(g1 * g1, (7, 7), 1.5) - mu1 ** 2; s22 = cv2.GaussianBlur(g2 * g2, (7, 7), 1.5) - mu2 ** 2; s12 = cv2.GaussianBlur(g1 * g2, (7, 7), 1.5) - mu1 * mu2
    csm = (2 * s12 + c2) / (s11 + s22 + c2)
    print("coarse contrast-structure SSIM per cell")
    for r in range(4): print("  " + "  ".join(f"{100 * csm[r * 90 // 4:(r + 1) * 90 // 4, c * 135 // 6:(c + 1) * 135 // 6].mean():5.0f} " for c in range(6)))
    LR, LU = cv2.cvtColor(R, cv2.COLOR_RGB2LAB).astype(float), cv2.cvtColor(U, cv2.COLOR_RGB2LAB).astype(float)
    for ch, nm in ((0, "L*"), (1, "a*"), (2, "b*")):
        off = 0 if ch == 0 else 128
        m = lambda L: grid(lambda ys, xs: float(L[ys, xs, ch][mask[ys, xs]].mean() - off) if mask[ys, xs].any() else 0.0)
        table(f"{nm} reference/runtime", m(LR), m(LU), fmt="{:5.1f}")


if __name__ == "__main__":
    main()
