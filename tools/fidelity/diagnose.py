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
    LR, LU = cv2.cvtColor(R, cv2.COLOR_RGB2LAB).astype(float), cv2.cvtColor(U, cv2.COLOR_RGB2LAB).astype(float)
    for ch, nm in ((0, "L*"), (1, "a*"), (2, "b*")):
        off = 0 if ch == 0 else 128
        m = lambda L: grid(lambda ys, xs: float(L[ys, xs, ch][mask[ys, xs]].mean() - off) if mask[ys, xs].any() else 0.0)
        table(f"{nm} reference/runtime", m(LR), m(LU), fmt="{:5.1f}")


if __name__ == "__main__":
    main()
