#!/usr/bin/env python3
"""Per-pixel geometry check against the reference depth pass, from the fitted crypt camera.

The reference depth (artifacts/image-run/crypt/depth.png) is relative; it is converted to metres
with a linear fit on walkway floor pixels, where the true distance is known from the camera. Both
depth maps are then turned back into world points, giving per-pixel height above the floor and the
signed distance error (runtime minus reference; negative = runtime geometry too close).

    node tools/fidelity/depthdump.mjs --out run.f32
    python3 tools/fidelity/depthdiff.py run.f32 --out depthdiff.png [--json stats.json]
"""
import argparse, json, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))
import refcam as rc

ROOT = Path(__file__).resolve().parents[2]
W, H = 768, 512


def ref_depth_metres():
    g = np.array(Image.open(ROOT / "artifacts/image-run/crypt/depth.png").convert("L").resize((W, H), Image.Resampling.BILINEAR)).astype(float)
    t, _ = rc.floor_distance(W, H)
    m = np.zeros((H, W), bool); m[int(H * 0.36):int(H * 0.95), int(W * 0.3):int(W * 0.7)] = True
    m &= (g > 20) & (g < 250)
    A = np.stack([np.ones(m.sum()), g[m]], 1)
    coef, *_ = np.linalg.lstsq(A, t[m], rcond=None)
    # one refit after dropping outliers (debris on the floor)
    res = t[m] - A @ coef; keep = np.abs(res) < 2.5 * res.std()
    coef, *_ = np.linalg.lstsq(A[keep], t[m][keep], rcond=None)
    return coef[0] + coef[1] * g, coef


def heat(v, lo, hi, cmap):
    x = np.clip((v - lo) / (hi - lo), 0, 1)
    return (np.stack([np.interp(x, cmap[:, 0], cmap[:, k]) for k in (1, 2, 3)], -1) * 255).astype(np.uint8)


DIV = np.array([[0, .15, .35, 1], [.5, .95, .95, .95], [1, 1, .25, .15]])          # blue-white-red
ELEV = np.array([[0, .1, .1, .5], [.35, .2, .6, .3], [.55, .95, .9, .3], [.8, 1, .5, .2], [1, 1, 1, 1]])


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("runtime"); ap.add_argument("--out", required=True); ap.add_argument("--json"); ap.add_argument("--ref", help="refined reference depth .npy")
    a = ap.parse_args()
    dref, coef = ref_depth_metres()
    if a.ref: dref = np.load(a.ref).astype(float)
    drun = np.fromfile(a.runtime, np.float32).reshape(H, W).astype(float)
    r = rc.rays(W, H)
    Pref = rc.EYE + r * dref[..., None]; Prun = rc.EYE + r * drun[..., None]
    href, hrun = Pref[..., 1], Prun[..., 1]
    err = drun - dref
    valid = drun < 200
    tiles = [Image.fromarray(heat(href, -1.5, 7, ELEV)), Image.fromarray(heat(np.where(valid, hrun, np.nan), -1.5, 7, ELEV)),
             Image.fromarray(heat(np.where(valid, err, 0), -3, 3, DIV)), Image.fromarray(heat(np.where(valid, hrun - href, 0), -2, 2, DIV))]
    labels = ["reference height above floor (m): -1.5 blue .. 7 white", "runtime height above floor",
              "distance error run-ref (m): blue = runtime too close, red = too far, +-3", "height error run-ref (m), +-2"]
    sheet = Image.new("RGB", (W * 2, H * 2 + 40), (20, 20, 20))
    for k, (t, lab) in enumerate(zip(tiles, labels)):
        x, y = (k % 2) * W, (k // 2) * (H + 20)
        sheet.paste(t, (x, y + 20)); ImageDraw.Draw(sheet).text((x + 6, y + 4), lab, fill=(255, 255, 0))
    # 6x4 cell grid on the error tiles
    d = ImageDraw.Draw(sheet)
    for k in (2, 3):
        x0, y0 = (k % 2) * W, (k // 2) * (H + 20) + 20
        for c in range(1, 6): d.line([(x0 + c * W // 6, y0), (x0 + c * W // 6, y0 + H)], fill=(80, 80, 80))
        for rr in range(1, 4): d.line([(x0, y0 + rr * H // 4), (x0 + W, y0 + rr * H // 4)], fill=(80, 80, 80))
    sheet.save(a.out)
    ae = np.abs(np.where(valid, err, 0))
    cells = [[float(np.median(ae[rr * H // 4:(rr + 1) * H // 4, c * W // 6:(c + 1) * W // 6])) for c in range(6)] for rr in range(4)]
    stats = {"refFit": {"a": coef[0], "b": coef[1]}, "medianAbsErrorM": float(np.median(ae)), "within0_5m": float((ae < 0.5).mean()), "cellMedianAbsErrorM": cells}
    print(f"ref depth = {coef[0]:.2f} + {coef[1]:.4f}*grey;  median |error| {stats['medianAbsErrorM']:.2f} m;  {100 * stats['within0_5m']:.1f}% of pixels within 0.5 m")
    for row in cells: print("  " + " ".join(f"{v:5.2f}" for v in row))
    if a.json: Path(a.json).write_text(json.dumps(stats, indent=1))


if __name__ == "__main__":
    main()
