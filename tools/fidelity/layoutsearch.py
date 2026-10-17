#!/usr/bin/env python3
"""Fit room-layout parameters to the reference clay pass by coordinate descent.

Each candidate reloads the crypt with ?layout={...}&pass=clay&ui=0&actors=0, captures 1920x1080
and is scored with claymatch (large-scale shading + silhouette correlation with the reference
clay). Prints the best layout as JSON for src/world.js LAYOUT.

    python3 -m http.server 8000 &
    python3 tools/fidelity/layoutsearch.py --params walk,pierUX,pierUZ --rounds 2
"""
import argparse, json, subprocess, sys, tempfile
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools/fidelity"))
import claymatch as cm

# name: (step, lo, hi)
SPACE = {
    "walk": (0.4, 5.5, 9.5), "backZ": (0.2, -8.8, -8.2), "backH": (1.0, 3, 10), "recessHalf": (0.5, 2.5, 5.5),
    "bannerPierX": (0.5, 4, 9), "bannerX": (0.5, 3, 8),
    "curbW": (0.4, 0.4, 3.0), "curbH": (0.15, 0.1, 1.2), "upperEnd": (0.6, -2, 3.5), "upperWallX": (0.6, 8.5, 13), "upperWallH": (0.4, 0.4, 3.5),
    "plinthW": (0.3, 1.0, 2.6), "plinthH": (0.25, 0.5, 2.0), "shaftW": (0.15, 0.5, 1.4), "pierTop": (0.4, 1.8, 5),
    "pierUX": (0.4, 7, 11), "pierUZ": (0.6, -3, 3), "pierU2X": (0.4, 7, 11), "pierU2Z": (0.6, -7, -1),
    "lowerStart": (0.6, 1, 6), "stepN": (1, 1, 5), "stepH": (0.1, 0.15, 0.8), "stepW": (0.15, 0.4, 1.4),
    "pierLX": (0.4, 7.5, 12), "pierLZ": (0.6, 4, 10), "pierBX": (0.4, 7.5, 12), "pierBZ": (0.6, 9, 15),
    "outerX": (0.6, 10.5, 16), "outerH": (0.5, 0.5, 6),
    "hScale": (0.1, 0.4, 1.4), "course": (0.1, 0.2, 0.8), "mass": (1, 0, 1), "sideRange": (1, 0, 1),
}


def defaults():
    src = (ROOT / "src/world.js").read_text()
    body = src[src.index("export const LAYOUT = {") + len("export const LAYOUT = "):]
    body = body[:body.index("};") + 1]
    import re
    body = re.sub(r"//[^\n]*", "", body)
    body = re.sub(r"([A-Za-z0-9_]+):", r'"\1":', body)
    body = re.sub(r",\s*}", "}", body)
    return json.loads(body)


class Driver:
    def __init__(self):
        self.p = subprocess.Popen(["node", str(ROOT / "tools/fidelity/search_driver.mjs")], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, cwd=ROOT)

    def shot(self, layout, out):
        q = "pass=clay&ui=0&actors=0&layout=" + json.dumps(layout, separators=(",", ":"))
        for cmd in ({"screen": "crypt", "query": q}, {"out": str(out)}):
            self.p.stdin.write(json.dumps(cmd) + "\n"); self.p.stdin.flush()
            r = json.loads(self.p.stdout.readline())
            if not r.get("ok"): raise RuntimeError(r)


def score(path, region=None):
    ref = cm.feats(cm.load(ROOT / "artifacts/image-run/crypt/clay.png", False)); run = cm.feats(cm.load(path, True))
    if region:
        x0, y0, x1, y1 = region
        sl = (slice(int(y0 * cm.H), int(y1 * cm.H)), slice(int(x0 * cm.W), int(x1 * cm.W)))
        ref, run = [f[sl] for f in ref], [f[sl] for f in run]
    return 50 * (cm.corr(ref[0], run[0]) + cm.corr(ref[1], run[1]))


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--params", required=True); ap.add_argument("--rounds", type=int, default=2)
    ap.add_argument("--region", help="x0,y0,x1,y1 as frame fractions; score only that region"); ap.add_argument("--init", type=Path)
    a = ap.parse_args()
    L = defaults()
    if a.init: L.update(json.loads(a.init.read_text()))
    names = a.params.split(","); region = tuple(float(v) for v in a.region.split(",")) if a.region else None
    drv, tmp, n = Driver(), Path(tempfile.mkdtemp()), [0]
    cache = {}

    def f(lay):
        key = tuple(round(lay[k], 3) for k in names)
        if key not in cache:
            out = tmp / f"c{n[0]}.png"; n[0] += 1; drv.shot(lay, out); cache[key] = score(out, region)
        return cache[key]

    best = f(L); print(f"start {best:.2f}", flush=True)
    steps = {k: SPACE[k][0] for k in names}
    for rnd in range(a.rounds):
        for k in names:
            lo, hi = SPACE[k][1], SPACE[k][2]
            imp = True
            while imp:
                imp = False
                for d in (1, -1):
                    t = dict(L); t[k] = min(hi, max(lo, L[k] + d * steps[k]))
                    if k in ("stepN", "mass", "sideRange"): t[k] = int(round(t[k]))
                    if t[k] == L[k]: continue
                    v = f(t)
                    if v > best + 0.05: best, L, imp = v, t, True; print(f"  r{rnd} {k}={t[k]:.2f} -> {best:.2f}", flush=True); break
        steps = {k: v / 2 if k not in ("stepN", "mass", "sideRange") else 1 for k, v in steps.items()}
    print(json.dumps({k: round(L[k], 3) for k in L}))


if __name__ == "__main__":
    main()
