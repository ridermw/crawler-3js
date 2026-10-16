#!/usr/bin/env python3
"""Coordinate-descent tuner for camera pose, colour grade and light levels against the v2 gate.

Geometry is authored by hand; this only registers the camera to the reference framing and
balances exposure and tint, the parameters a person would otherwise nudge by eye. The objective
is the scene part of the gate's overall score, 0.45 * sceneStructure + 0.20 * sceneColor, so the
search cannot trade UI placement against scene fit.

    python3 -m http.server 8000 &
    python3 tools/fidelity/search.py --screen crypt --groups pose --rounds 2
    python3 tools/fidelity/search.py --screen title --groups pose,grade,lights

Prints the best parameters as JSON; copy them into POSES / CryptGrade in src/main.js.
"""
from __future__ import annotations

import argparse
import copy
import importlib.util
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent.parent
spec = importlib.util.spec_from_file_location("compare_scene", ROOT / "tools/fidelity/compare-scene.py")
cs = importlib.util.module_from_spec(spec)
sys.modules["compare_scene"] = cs
spec.loader.exec_module(cs)

REF = {"title": "ashen-reliquary-title", "settings": "ashen-reliquary-settings", "crypt": "ashen-reliquary"}

# name: (group, key, index or None, step, lo, hi)
SPACE = {
    "tx": ("pose", "target", 0, 0.6, -6, 6), "ty": ("pose", "target", 1, 0.5, -2, 4), "tz": ("pose", "target", 2, 0.6, -9, 6),
    "yaw": ("pose", "yaw", None, 4, -45, 45), "pitch": ("pose", "pitch", None, 3, 15, 60), "height": ("pose", "height", None, 1.0, 6, 26), "fov": ("pose", "fov", None, 8, 2, 70),
    "gain": ("grade", "gain", None, 0.08, 0.5, 1.6), "sat": ("grade", "sat", None, 0.1, 0.3, 1.2),
    "loR": ("grade", "lo", 0, 0.04, 0.7, 1.3), "loB": ("grade", "lo", 2, 0.04, 0.7, 1.3),
    "hiR": ("grade", "hi", 0, 0.04, 0.7, 1.3), "hiB": ("grade", "hi", 2, 0.04, 0.7, 1.3),
    "shade": ("grade", "shade", None, 0.1, 0, 1),
    "moon": ("lights", "moon", None, 0.3, 0, 5), "hemi": ("lights", "hemi", None, 0.25, 0, 4), "candles": ("lights", "candles", None, 0.2, 0.1, 3), "pool": ("lights", "pool", None, 1.0, 0, 20),
}
GROUPS = {"pose": ["fov", "tx", "ty", "tz", "yaw", "pitch", "height"], "grade": ["gain", "sat", "loR", "loB", "hiR", "hiB", "shade"], "lights": ["moon", "hemi", "candles", "pool"]}


def clay_features(g: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    g = cv2.resize(g, (600, 400), interpolation=cv2.INTER_AREA).astype(np.float32)
    g = (g - g.mean()) / (g.std() + 1e-6)
    lum = cv2.GaussianBlur(g, (0, 0), 6)
    gx, gy = cv2.Sobel(cv2.GaussianBlur(g, (0, 0), 2), cv2.CV_32F, 1, 0), cv2.Sobel(cv2.GaussianBlur(g, (0, 0), 2), cv2.CV_32F, 0, 1)
    edge = cv2.GaussianBlur(np.hypot(gx, gy), (0, 0), 4)
    return lum, edge


def clay_score(a, b) -> tuple[float, dict]:
    corr = lambda x, y: float(np.corrcoef(x.ravel(), y.ravel())[0, 1])
    l, e = corr(a[0], b[0]), corr(a[1], b[1])
    return 50 * (l + e), {"lum": round(l, 3), "edge": round(e, 3)}


class Driver:
    def __init__(self, screen: str, query: str = ""):
        self.p = subprocess.Popen(["node", str(ROOT / "tools/fidelity/search_driver.mjs")], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, cwd=ROOT)
        self.send({"screen": screen, "query": query})

    def send(self, cmd: dict) -> dict:
        self.p.stdin.write(json.dumps(cmd) + "\n"); self.p.stdin.flush()
        r = json.loads(self.p.stdout.readline())
        if not r.get("ok"):
            raise RuntimeError(r)
        return r

    def close(self) -> None:
        self.p.stdin.close(); self.p.wait()


def build_cmd(vals: dict, initial: dict) -> dict:
    cmd = copy.deepcopy(initial)
    for name, v in vals.items():
        grp, key, idx, *_ = SPACE[name]
        g = cmd.setdefault(grp, {})
        if idx is None:
            g[key] = v
        else:
            g[key][idx] = v
    return cmd


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--screen", required=True, choices=REF)
    ap.add_argument("--groups", default="pose")
    ap.add_argument("--rounds", type=int, default=2)
    ap.add_argument("--step-scale", type=float, default=1.0, help="scale every initial step (use <1 to refine)")
    ap.add_argument("--init", type=Path, help="JSON with initial pose/grade/lights")
    ap.add_argument("--clay", type=Path, help="register geometry against an image-run clay pass instead of the gate")
    a = ap.parse_args()
    init = json.loads(a.init.read_text()) if a.init else {}
    drv = Driver(a.screen, "pass=clay&ui=0&actors=0" if a.clay else "")
    clay_ref = clay_features(np.array(Image.open(a.clay).convert("L"))) if a.clay else None
    initial = {"pose": {"target": [0, 0, 0]}, "grade": {"lo": [0.96, 0.99, 1.04], "hi": [1.04, 1.0, 0.95], "gain": 1.0, "sat": 0.9, "shade": 0}, "lights": {"candles": 1.0}}
    for k, v in init.items():
        initial.setdefault(k, {}).update(v)
    names = [n for g in a.groups.split(",") for n in GROUPS[g]]
    vals = {}
    for n in names:
        grp, key, idx, *_ = SPACE[n]
        cur = initial[grp].get(key)
        if cur is None:
            raise SystemExit(f"--init must give a starting value for {grp}.{key}")
        vals[n] = cur[idx] if idx is not None else cur
    ref = ROOT / "artifacts/mockups" / f"{REF[a.screen]}.png"
    tmp = Path(tempfile.mkdtemp(prefix="crawler-search-"))
    cache: dict[tuple, tuple[float, dict]] = {}
    count = [0]

    def score(v: dict) -> tuple[float, dict]:
        key = tuple(round(v[n], 4) for n in names)
        if key in cache:
            return cache[key]
        out = tmp / f"c{count[0]}.png"; count[0] += 1
        drv.send({**build_cmd(v, initial), "out": str(out)})
        if clay_ref is not None:
            g = Image.open(out).convert("L")
            cw = round(g.height * 1.5); g = g.crop(((g.width - cw) // 2, 0, (g.width - cw) // 2 + cw, g.height))
            o, info = clay_score(clay_ref, clay_features(np.array(g)))
            cache[key] = (o, info); return cache[key]
        rep, *_ = cs.evaluate_screen(a.screen, ref, out)
        s = rep["scene"]
        obj = 0.45 * s["sceneStructure"] + 0.20 * s["sceneColor"]
        cache[key] = (obj, {"struct": round(s["sceneStructure"], 2), "color": round(s["sceneColor"], 2)})
        return cache[key]

    best, info = score(vals)
    print(f"start obj={best:.2f} {info} {vals}", flush=True)
    steps = {n: SPACE[n][3] * a.step_scale for n in names}
    for rnd in range(a.rounds):
        for n in names:
            lo, hi = SPACE[n][4], SPACE[n][5]
            improved = True
            while improved:
                improved = False
                for d in (+1, -1):
                    trial = dict(vals); trial[n] = min(hi, max(lo, vals[n] + d * steps[n]))
                    if trial[n] == vals[n]:
                        continue
                    o, i = score(trial)
                    if o > best + 0.05:
                        best, info, vals, improved = o, i, trial, True
                        print(f"  r{rnd} {n}={vals[n]:.3f} obj={best:.2f} {info}", flush=True)
                        break
        steps = {n: s / 2 for n, s in steps.items()}
    drv.close()
    print(json.dumps({"objective": round(best, 3), **info, "params": build_cmd(vals, initial)}, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
