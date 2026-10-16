#!/usr/bin/env python3
"""Structure-, color-, and UI-aware visual fidelity gate for The Ashen Reliquary.

Replaces the legacy single-scale Canny scorer while keeping `--legacy` available
for backward comparison.

Key capabilities:
- Supports `--screen title|settings|crypt` and `--all` with per-screen default
  paths for reference mocks, runtime captures, JSON reports, and comparison PNGs.
- Splits scoring into 3D SCENE (with UI boxes masked out) and UI (per-element
  placement offset in pixels + content similarity).
- Resolves the 3:2 (1536x1024) vs 16:9 (1920x1080) aspect difference via
  anchor-aware UI mapping (`--ui-frame auto|edge|safe`), so edge-anchored 16:9
  HUD elements are scored at the real 16:9 screen edges without forcing an
  unnatural 150px inset.
- Resists noise via multi-scale pre-smoothed Canny (sigma=2.0 and 3.5),
  12x8 Sobel orientation histograms (HOG), coarse contrast-structure SSIM, and
  per-cell CIE Lab color/luminance histograms.
- Built-in `--calibrate` mode runs the perturbation / fake / cross-mock suite.
- Exits non-zero (1) when a screen fails the threshold gate (disable with
  `--no-fail`).
"""

from __future__ import annotations

import argparse
import io
import json
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

try:
    import cv2
except ModuleNotFoundError:
    print(
        "compare-scene.py requires OpenCV. Install it with:\n"
        "    python -m pip install opencv-python-headless",
        file=sys.stderr,
    )
    raise SystemExit(2)

SCHEMA = "ashen-reliquary-scene-fidelity/v2"
ALGORITHM_VERSION = "2.0.0"

CANNY_LOW = 25
CANNY_HIGH = 70
BLUR_SIGMA = 12.0
GRID_COLUMNS = 6
GRID_ROWS = 4
FINE_COLUMNS = 12
FINE_ROWS = 8
WORKING_HEIGHT = 540
LEGACY_PANEL = (960, 540)
LEGACY_MATTE = (11, 13, 16)

GATE_THRESHOLDS = {
    "sceneStructure": 75.0,
    "sceneColor": 80.0,
    "uiPlacement": 85.0,
    "uiContent": 78.0,
    "overallScore": 82.0,
}

REPO_ROOT = Path(__file__).resolve().parent.parent.parent

SCREEN_CONFIGS = {
    "title": {
        "reference": REPO_ROOT / "artifacts" / "mockups" / "ashen-reliquary-title.png",
        "runtime": REPO_ROOT / "artifacts" / "validation" / "ashen-reliquary-title-runtime.png",
        "report": REPO_ROOT / "artifacts" / "validation" / "ashen-reliquary-title-fidelity.json",
        "comparison": REPO_ROOT / "artifacts" / "validation" / "ashen-reliquary-title-comparison.png",
    },
    "settings": {
        "reference": REPO_ROOT / "artifacts" / "mockups" / "ashen-reliquary-settings.png",
        "runtime": REPO_ROOT / "artifacts" / "validation" / "ashen-reliquary-settings-runtime.png",
        "report": REPO_ROOT / "artifacts" / "validation" / "ashen-reliquary-settings-fidelity.json",
        "comparison": REPO_ROOT / "artifacts" / "validation" / "ashen-reliquary-settings-comparison.png",
    },
    "crypt": {
        "reference": REPO_ROOT / "artifacts" / "mockups" / "ashen-reliquary.png",
        "runtime": REPO_ROOT / "artifacts" / "validation" / "ashen-reliquary-crypt-runtime.png",
        "report": REPO_ROOT / "artifacts" / "validation" / "ashen-reliquary-crypt-fidelity.json",
        "comparison": REPO_ROOT / "artifacts" / "validation" / "ashen-reliquary-crypt-comparison.png",
    },
}

DEFAULT_UI_LAYOUTS: dict[str, list[dict[str, object]]] = {
    "title": [
        {"id": "title_lockup", "anchor": "safe", "box": [136, 408, 636, 576], "tolerant_text": False},
        {"id": "divider", "anchor": "safe", "box": [248, 570, 522, 606], "tolerant_text": False},
        {"id": "subtitle", "anchor": "safe", "box": [236, 618, 546, 640], "tolerant_text": False},
        {"id": "menu_rows", "anchor": "safe", "box": [160, 664, 464, 812], "tolerant_text": False},
        {"id": "click_hint", "anchor": "safe", "box": [238, 842, 428, 862], "tolerant_text": False},
        {"id": "footer_left", "anchor": "bottom-left", "box": [100, 960, 360, 982], "tolerant_text": True},
        {"id": "footer_right", "anchor": "bottom-right", "box": [1455, 960, 1492, 982], "tolerant_text": False},
    ],
    "settings": [
        {"id": "settings_panel", "anchor": "safe", "box": [120, 120, 722, 902], "tolerant_text": False},
    ],
    "crypt": [
        {"id": "objective", "anchor": "top-left", "box": [24, 28, 238, 92], "tolerant_text": False},
        {"id": "boss_bar", "anchor": "top-center", "box": [556, 10, 978, 74], "tolerant_text": False},
        {"id": "minimap", "anchor": "top-right", "box": [1278, 10, 1528, 258], "tolerant_text": False},
        {"id": "health_orb", "anchor": "bottom-left", "box": [36, 762, 228, 986], "tolerant_text": False},
        {"id": "action_bar", "anchor": "bottom-center", "box": [482, 844, 1054, 994], "tolerant_text": False},
        {"id": "loot_toast", "anchor": "bottom-right", "box": [1278, 690, 1526, 748], "tolerant_text": True},
        {"id": "essence_orb", "anchor": "bottom-right", "box": [1312, 762, 1504, 986], "tolerant_text": False},
    ],
}


@dataclass(frozen=True)
class Overlap:
    width: int
    height: int
    left: int
    top: int

    @property
    def band_width(self) -> int:
        return self.left

    @property
    def band_height(self) -> int:
        return self.top


def compute_overlap(
    reference_size: tuple[int, int], runtime_size: tuple[int, int]
) -> Overlap:
    reference_width, reference_height = reference_size
    runtime_width, runtime_height = runtime_size
    if min(reference_size) <= 0 or min(runtime_size) <= 0:
        raise ValueError("image dimensions must be positive")

    width = int(round(runtime_height * reference_width / reference_height))
    if width <= runtime_width:
        height = runtime_height
    else:
        width = runtime_width
        height = int(round(runtime_width * reference_height / reference_width))
    return Overlap(
        width=width,
        height=height,
        left=(runtime_width - width) // 2,
        top=(runtime_height - height) // 2,
    )


def working_size(reference_size: tuple[int, int]) -> tuple[int, int]:
    reference_width, reference_height = reference_size
    width = int(round(WORKING_HEIGHT * reference_width / reference_height))
    return width, WORKING_HEIGHT


def _resize(image: Image.Image, size: tuple[int, int]) -> np.ndarray:
    return np.array(image.resize(size, Image.Resampling.LANCZOS))


def load_ui_layout(screen: str, reference_path: Path) -> list[dict[str, object]]:
    json_path = reference_path.with_suffix(".layout.json")
    if json_path.is_file():
        data = json.loads(json_path.read_text(encoding="utf-8"))
        return data.get("elements", data)
    return DEFAULT_UI_LAYOUTS.get(screen, DEFAULT_UI_LAYOUTS["title"])


def map_box_to_runtime(
    box: list[int],
    anchor: str,
    ref_size: tuple[int, int],
    run_size: tuple[int, int],
    mode: str,
) -> tuple[int, int, int, int]:
    """Map a (x0, y0, x1, y1) box from reference (1536x1024) to runtime (1920x1080)."""
    ref_w, ref_h = ref_size
    run_w, run_h = run_size
    overlap = compute_overlap(ref_size, run_size)
    scale = overlap.height / float(ref_h)

    x0, y0, x1, y1 = box
    w = int(round((x1 - x0) * scale))
    h = int(round((y1 - y0) * scale))
    ry0 = overlap.top + int(round(y0 * scale))

    use_safe = mode == "safe" or anchor == "safe"
    if use_safe:
        rx0 = overlap.left + int(round(x0 * scale))
    elif "left" in anchor:
        rx0 = int(round(x0 * scale))
    elif "right" in anchor:
        rx0 = run_w - int(round((ref_w - x1) * scale)) - w
    else:
        cx_offset = ((x0 + x1) * 0.5 - ref_w * 0.5) * scale
        rx0 = int(round(run_w * 0.5 + cx_offset - w * 0.5))

    rx0 = max(0, min(run_w - w, rx0))
    ry0 = max(0, min(run_h - h, ry0))
    return rx0, ry0, rx0 + w, ry0 + h


def build_scene_mask_working(
    working_shape: tuple[int, int],
    ref_size: tuple[int, int],
    run_size: tuple[int, int],
    ui_elements: list[dict[str, object]],
    chosen_runtime_boxes: list[tuple[int, int, int, int]],
) -> np.ndarray:
    """Return a boolean mask on the (540, 810) working canvas with all UI boxes False."""
    wh, ww = working_shape[:2]
    ref_w, ref_h = ref_size
    overlap = compute_overlap(ref_size, run_size)
    mask = np.ones((wh, ww), dtype=bool)

    sx_ref, sy_ref = ww / float(ref_w), wh / float(ref_h)
    for elem in ui_elements:
        x0, y0, x1, y1 = elem["box"]
        mask[
            max(0, int(y0 * sy_ref)) : min(wh, int(np.ceil(y1 * sy_ref))),
            max(0, int(x0 * sx_ref)) : min(ww, int(np.ceil(x1 * sx_ref))),
        ] = False

    sx_ov, sy_ov = ww / float(overlap.width), wh / float(overlap.height)
    for rx0, ry0, rx1, ry1 in chosen_runtime_boxes:
        cx0 = max(0, rx0 - overlap.left)
        cy0 = max(0, ry0 - overlap.top)
        cx1 = min(overlap.width, rx1 - overlap.left)
        cy1 = min(overlap.height, ry1 - overlap.top)
        if cx1 > cx0 and cy1 > cy0:
            mask[
                int(cy0 * sy_ov) : int(np.ceil(cy1 * sy_ov)),
                int(cx0 * sx_ov) : int(np.ceil(cx1 * sx_ov)),
            ] = False
    return mask


# ---------------------------------------------------------------------
# Legacy metrics (preserved for --legacy and cell diagnostics)
# ---------------------------------------------------------------------

def edge_map(image: np.ndarray) -> np.ndarray:
    grayscale = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    return cv2.Canny(grayscale, CANNY_LOW, CANNY_HIGH) > 0


def cell_bounds(
    shape: tuple[int, int], rows: int = GRID_ROWS, cols: int = GRID_COLUMNS
) -> list[tuple[int, int, int, int, int, int]]:
    height, width = shape
    bounds = []
    for row in range(rows):
        for column in range(cols):
            bounds.append(
                (
                    row,
                    column,
                    row * height // rows,
                    (row + 1) * height // rows,
                    column * width // cols,
                    (column + 1) * width // cols,
                )
            )
    return bounds


def distribution_vector(
    edges: np.ndarray,
    mask: np.ndarray | None = None,
    rows: int = GRID_ROWS,
    cols: int = GRID_COLUMNS,
) -> np.ndarray:
    densities = []
    for _, _, top, bottom, left, right in cell_bounds(edges.shape, rows, cols):
        sub_e = edges[top:bottom, left:right]
        if mask is not None:
            sub_m = mask[top:bottom, left:right]
            densities.append(float(sub_e[sub_m].mean()) if sub_m.any() else 0.0)
        else:
            densities.append(float(sub_e.mean()))
    arr = np.array(densities, dtype=np.float64)
    total = arr.sum()
    if total == 0:
        return np.zeros_like(arr)
    return arr / total


def _normalised_similarity(first: np.ndarray, second: np.ndarray) -> float:
    error = float(np.mean(np.abs(first.astype(np.float64) - second.astype(np.float64))))
    return 100.0 * (1.0 - error / 255.0)


def compare_legacy(reference: np.ndarray, runtime: np.ndarray) -> dict[str, object]:
    pixel_similarity = _normalised_similarity(reference, runtime)
    low_frequency = _normalised_similarity(
        cv2.GaussianBlur(reference, (0, 0), BLUR_SIGMA),
        cv2.GaussianBlur(runtime, (0, 0), BLUR_SIGMA),
    )
    reference_edges = edge_map(reference)
    runtime_edges = edge_map(runtime)
    reference_density = float(reference_edges.mean())
    runtime_density = float(runtime_edges.mean())
    highest = max(reference_density, runtime_density)
    coverage = (
        100.0 * (min(reference_density, runtime_density) / highest)
        if highest
        else 100.0
    )
    ref_dist = distribution_vector(reference_edges)
    run_dist = distribution_vector(runtime_edges)
    distribution = 100.0 * (1.0 - 0.5 * float(np.abs(ref_dist - run_dist).sum()))
    structural = 0.70 * distribution + 0.30 * coverage

    cells = []
    for row, column, top, bottom, left, right in cell_bounds(reference_edges.shape):
        cell_reference = float(reference_edges[top:bottom, left:right].mean())
        cell_runtime = float(runtime_edges[top:bottom, left:right].mean())
        cells.append(
            {
                "row": row,
                "column": column,
                "referenceEdgeDensity": cell_reference,
                "runtimeEdgeDensity": cell_runtime,
                "ratioPercent": (
                    100.0 * cell_runtime / cell_reference if cell_reference else None
                ),
                "deficit": cell_reference - cell_runtime,
            }
        )
    return {
        "pixelSimilarity": pixel_similarity,
        "lowFrequencyComposition": low_frequency,
        "referenceEdgeDensity": reference_density,
        "runtimeEdgeDensity": runtime_density,
        "edgeDensityCoverage": coverage,
        "edgeDistributionSimilarity": distribution,
        "structuralMetric": structural,
        "cells": cells,
    }


# ---------------------------------------------------------------------
# v2 Structure-, Color-, and UI-aware metrics
# ---------------------------------------------------------------------

def multiscale_edges(gray: np.ndarray, mask: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    vals = gray[mask].astype(np.float32) if mask.any() else gray.astype(np.float32)
    p95 = max(float(np.percentile(vals, 95)), 40.0)
    norm_g = np.clip(gray.astype(np.float32) * (120.0 / p95), 0, 255).astype(np.uint8)
    g1 = cv2.GaussianBlur(norm_g, (0, 0), 2.0)
    g2 = cv2.GaussianBlur(norm_g, (0, 0), 3.5)
    e1 = (cv2.Canny(g1, 20, 52) > 0) & mask
    e2 = (cv2.Canny(g2, 16, 42) > 0) & mask
    return e1, e2


def hog_descriptor(
    gray: np.ndarray,
    mask: np.ndarray,
    rows: int = FINE_ROWS,
    cols: int = FINE_COLUMNS,
    bins: int = 8,
) -> np.ndarray:
    g = cv2.GaussianBlur(gray.astype(np.float32), (0, 0), 2.2)
    gx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)
    mag = np.maximum(0.0, np.hypot(gx, gy) - 12.0) * mask
    ang = (np.arctan2(gy, gx) % np.pi) / np.pi * bins
    b_idx = np.clip(ang.astype(int), 0, bins - 1)
    hists = []
    for _, _, top, bottom, left, right in cell_bounds(gray.shape, rows, cols):
        m_cell = mag[top:bottom, left:right]
        b_cell = b_idx[top:bottom, left:right]
        hists.append(
            np.bincount(b_cell.ravel(), weights=m_cell.ravel(), minlength=bins)
        )
    vec = np.concatenate(hists)
    total = vec.sum()
    return vec / total if total > 0 else np.zeros_like(vec)


def coarse_contrast_ssim(
    gray1: np.ndarray, gray2: np.ndarray, mask: np.ndarray
) -> float:
    g1 = cv2.resize(
        cv2.GaussianBlur(gray1.astype(np.float32), (0, 0), 3.5),
        (135, 90),
        interpolation=cv2.INTER_AREA,
    )
    g2 = cv2.resize(
        cv2.GaussianBlur(gray2.astype(np.float32), (0, 0), 3.5),
        (135, 90),
        interpolation=cv2.INTER_AREA,
    )
    m = (
        cv2.resize(
            mask.astype(np.float32), (135, 90), interpolation=cv2.INTER_NEAREST
        )
        > 0.5
    )
    c2 = (0.03 * 255) ** 2
    mu1 = cv2.GaussianBlur(g1, (7, 7), 1.5)
    mu2 = cv2.GaussianBlur(g2, (7, 7), 1.5)
    sig1_sq = cv2.GaussianBlur(g1 * g1, (7, 7), 1.5) - mu1 * mu1
    sig2_sq = cv2.GaussianBlur(g2 * g2, (7, 7), 1.5) - mu2 * mu2
    sig12 = cv2.GaussianBlur(g1 * g2, (7, 7), 1.5) - mu1 * mu2
    cs_map = (2.0 * sig12 + c2) / (sig1_sq + sig2_sq + c2)
    val = float(cs_map[m].mean()) if m.any() else float(cs_map.mean())
    return float(np.clip(val, 0.0, 1.0) * 100.0)


def score_scene_color(
    rgb1: np.ndarray, rgb2: np.ndarray, mask: np.ndarray
) -> dict[str, float]:
    lab1 = cv2.cvtColor(rgb1, cv2.COLOR_RGB2LAB).astype(np.float32)
    lab2 = cv2.cvtColor(rgb2, cv2.COLOR_RGB2LAB).astype(np.float32)
    luma_errs, chroma_errs, hist_sims = [], [], []
    for _, _, top, bottom, left, right in cell_bounds(mask.shape, GRID_ROWS, GRID_COLUMNS):
        m = mask[top:bottom, left:right]
        if not m.any():
            continue
        p1 = lab1[top:bottom, left:right][m]
        p2 = lab2[top:bottom, left:right][m]
        luma_errs.append(abs(float(p1[:, 0].mean() - p2[:, 0].mean())))
        chroma_errs.append(
            float(np.linalg.norm(p1[:, 1:].mean(axis=0) - p2[:, 1:].mean(axis=0)))
        )
        h1, _ = np.histogram(p1[:, 0], bins=8, range=(0, 256), density=True)
        h2, _ = np.histogram(p2[:, 0], bins=8, range=(0, 256), density=True)
        hist_sims.append(100.0 * (1.0 - 0.5 * float(np.abs(h1 - h2).sum()) * 32.0))

    luma_sim = max(0.0, 100.0 * (1.0 - float(np.mean(luma_errs)) / 40.0))
    chroma_sim = max(0.0, 100.0 * (1.0 - float(np.mean(chroma_errs)) / 6.5))
    hist_sim = float(np.clip(np.mean(hist_sims), 0.0, 100.0))
    combined = 0.30 * luma_sim + 0.45 * chroma_sim + 0.25 * hist_sim
    return {
        "lumaSimilarity": luma_sim,
        "chromaSimilarity": chroma_sim,
        "lumaHistogramSimilarity": hist_sim,
        "sceneColor": combined,
    }


def score_scene(
    ref_rgb: np.ndarray, run_rgb: np.ndarray, mask: np.ndarray
) -> dict[str, object]:
    g_ref = cv2.cvtColor(ref_rgb, cv2.COLOR_RGB2GRAY)
    g_run = cv2.cvtColor(run_rgb, cv2.COLOR_RGB2GRAY)
    e1_ref, e2_ref = multiscale_edges(g_ref, mask)
    e1_run, e2_run = multiscale_edges(g_run, mask)

    def _cov(a: np.ndarray, b: np.ndarray) -> float:
        da = float(a[mask].mean()) if mask.any() else 0.0
        db = float(b[mask].mean()) if mask.any() else 0.0
        hi = max(da, db)
        return 100.0 * (min(da, db) / hi) if hi > 0 else 0.0

    cov1, cov2 = _cov(e1_ref, e1_run), _cov(e2_ref, e2_run)
    ms_cov = 0.5 * cov1 + 0.5 * cov2

    d1_ref = distribution_vector(e1_ref, mask, FINE_ROWS, FINE_COLUMNS)
    d1_run = distribution_vector(e1_run, mask, FINE_ROWS, FINE_COLUMNS)
    d2_ref = distribution_vector(e2_ref, mask, FINE_ROWS, FINE_COLUMNS)
    d2_run = distribution_vector(e2_run, mask, FINE_ROWS, FINE_COLUMNS)
    dist1 = (
        0.0
        if d1_run.sum() == 0
        else 100.0 * (1.0 - 0.5 * float(np.abs(d1_ref - d1_run).sum()))
    )
    dist2 = (
        0.0
        if d2_run.sum() == 0
        else 100.0 * (1.0 - 0.5 * float(np.abs(d2_ref - d2_run).sum()))
    )
    ms_dist = 0.5 * dist1 + 0.5 * dist2

    h_ref = hog_descriptor(g_ref, mask)
    h_run = hog_descriptor(g_run, mask)
    hog_sim = (
        0.0
        if h_run.sum() == 0
        else 100.0 * (1.0 - 0.5 * float(np.abs(h_ref - h_run).sum()))
    )
    ssim_val = coarse_contrast_ssim(g_ref, g_run, mask)
    scene_structure = 0.30 * ms_cov + 0.25 * ms_dist + 0.25 * hog_sim + 0.20 * ssim_val
    color_block = score_scene_color(ref_rgb, run_rgb, mask)

    return {
        "multiScaleEdgeCoverage": ms_cov,
        "multiScaleDistribution12x8": ms_dist,
        "hogOrientationSimilarity": hog_sim,
        "coarseContrastSsim": ssim_val,
        "sceneStructure": scene_structure,
        **color_block,
    }


def _score_single_ui_box(
    ref_patch: np.ndarray,
    run_patch: np.ndarray,
    tolerant_text: bool,
) -> tuple[float, float, tuple[float, float]]:
    """Return (placement_score, content_score, (dx_px, dy_px)) for one UI box."""
    h, w = ref_patch.shape[:2]
    run_resized = cv2.resize(run_patch, (w, h), interpolation=cv2.INTER_AREA)

    g_ref = cv2.cvtColor(ref_patch, cv2.COLOR_RGB2GRAY)
    g_run = cv2.cvtColor(run_resized, cv2.COLOR_RGB2GRAY)
    e_ref = cv2.Canny(g_ref, 25, 70) > 0
    e_run = cv2.Canny(g_run, 25, 70) > 0

    ys_r, xs_r = np.where(e_ref | (g_ref > 90))
    ys_u, xs_u = np.where(e_run | (g_run > 90))
    if len(xs_r) == 0 or len(xs_u) == 0:
        return 0.0, 0.0, (float(w), float(h))

    dx = float(xs_u.mean() - xs_r.mean())
    dy = float(ys_u.mean() - ys_r.mean())
    sx_err = abs(float(xs_u.std() - xs_r.std())) / max(float(w), 1.0)
    sy_err = abs(float(ys_u.std() - ys_r.std())) / max(float(h), 1.0)
    norm_shift = np.hypot(dx / max(float(w), 1.0), dy / max(float(h), 1.0))
    placement = float(
        np.clip(100.0 * (1.0 - 1.8 * norm_shift - 0.8 * (sx_err + sy_err)), 0.0, 100.0)
    )

    d_ref, d_run = float(e_ref.mean()), float(e_run.mean())
    hi = max(d_ref, d_run)
    cov = 100.0 * (min(d_ref, d_run) / hi) if hi > 0 else 0.0
    sub_ref = distribution_vector(e_ref, None, 2, 4)
    sub_run = distribution_vector(e_run, None, 2, 4)
    dist = (
        0.0
        if sub_run.sum() == 0
        else 100.0 * (1.0 - 0.5 * float(np.abs(sub_ref - sub_run).sum()))
    )
    lab1 = cv2.cvtColor(ref_patch, cv2.COLOR_RGB2LAB).astype(np.float32)
    lab2 = cv2.cvtColor(run_resized, cv2.COLOR_RGB2LAB).astype(np.float32)
    col_err = float(np.abs(lab1.mean(axis=(0, 1)) - lab2.mean(axis=(0, 1))).mean())
    col_sim = max(0.0, 100.0 * (1.0 - col_err / 25.0))

    if tolerant_text:
        content = 0.45 * cov + 0.55 * col_sim
    else:
        content = 0.40 * cov + 0.35 * dist + 0.25 * col_sim
    return placement, content, (dx, dy)


def score_ui(
    ref_full: np.ndarray,
    run_full: np.ndarray,
    ui_elements: list[dict[str, object]],
    ui_frame: str,
) -> tuple[dict[str, object], list[tuple[int, int, int, int]]]:
    ref_h, ref_w = ref_full.shape[:2]
    run_h, run_w = run_full.shape[:2]
    ref_size = (ref_w, ref_h)
    run_size = (run_w, run_h)

    element_reports = []
    chosen_boxes: list[tuple[int, int, int, int]] = []
    placements, contents = [], []

    for elem in ui_elements:
        box = elem["box"]
        anchor = str(elem["anchor"])
        tolerant = bool(elem.get("tolerant_text", False))
        x0, y0, x1, y1 = box
        ref_patch = ref_full[y0:y1, x0:x1]

        modes = ["edge", "safe"] if ui_frame == "auto" else [ui_frame]
        best = None
        for mode in modes:
            rx0, ry0, rx1, ry1 = map_box_to_runtime(box, anchor, ref_size, run_size, mode)
            run_patch = run_full[ry0:ry1, rx0:rx1]
            pl, co, (dx, dy) = _score_single_ui_box(ref_patch, run_patch, tolerant)
            cand = (0.5 * pl + 0.5 * co, pl, co, (dx, dy), (rx0, ry0, rx1, ry1), mode)
            if best is None or cand[0] > best[0]:
                best = cand

        assert best is not None
        _, pl, co, (dx, dy), rbox, chosen_mode = best
        chosen_boxes.append(rbox)
        placements.append(pl)
        contents.append(co)
        element_reports.append(
            {
                "id": elem["id"],
                "anchor": anchor,
                "matchedFrame": chosen_mode,
                "referenceBox": list(box),
                "runtimeBox": list(rbox),
                "offsetPx": {"dx": round(dx, 2), "dy": round(dy, 2)},
                "placementScore": pl,
                "contentScore": co,
            }
        )

    ui_placement = float(np.mean(placements)) if placements else 100.0
    ui_content = float(np.mean(contents)) if contents else 100.0
    return (
        {
            "uiFrameMode": ui_frame,
            "uiPlacement": ui_placement,
            "uiContent": ui_content,
            "elements": element_reports,
        },
        chosen_boxes,
    )


def build_comparison_image(
    reference_array: np.ndarray,
    runtime_array: np.ndarray,
    scene_mask: np.ndarray,
    legacy_cells: list[dict[str, object]],
) -> Image.Image:
    """Build a 3-panel review image on the scored 3:2 crop:
    Left: Reference crop | Middle: Runtime crop | Right: Edge & cell deficit overlay.
    """
    h, w = reference_array.shape[:2]
    ref_edges = cv2.Canny(cv2.cvtColor(reference_array, cv2.COLOR_RGB2GRAY), CANNY_LOW, CANNY_HIGH) > 0
    run_edges = cv2.Canny(cv2.cvtColor(runtime_array, cv2.COLOR_RGB2GRAY), CANNY_LOW, CANNY_HIGH) > 0

    overlay = (runtime_array.astype(np.float32) * 0.35).astype(np.uint8)
    overlay[ref_edges & ~run_edges & scene_mask] = [215, 55, 55]
    overlay[run_edges & scene_mask] = [75, 220, 115]
    overlay[~scene_mask] = (
        runtime_array[~scene_mask].astype(np.float32) * 0.55 + np.array([30, 55, 95]) * 0.45
    ).astype(np.uint8)

    out = Image.new("RGB", (w * 3, h), LEGACY_MATTE)
    out.paste(Image.fromarray(reference_array), (0, 0))
    out.paste(Image.fromarray(runtime_array), (w, 0))
    out.paste(Image.fromarray(overlay), (w * 2, 0))

    draw = ImageDraw.Draw(out)
    for cell in legacy_cells:
        r, c = int(cell["row"]), int(cell["column"])
        x0, y0 = w * 2 + c * w // GRID_COLUMNS, r * h // GRID_ROWS
        x1, y1 = w * 2 + (c + 1) * w // GRID_COLUMNS, (r + 1) * h // GRID_ROWS
        draw.rectangle([x0, y0, x1 - 1, y1 - 1], outline=(85, 95, 110))
        ratio = cell["ratioPercent"]
        if ratio is not None:
            color = (110, 230, 130) if 75 <= ratio <= 135 else (240, 110, 95)
            draw.text((x0 + 6, y0 + 5), f"{ratio:.0f}%", fill=color)
    return out


def _report_path(path: Path) -> str:
    resolved = path.resolve()
    try:
        return resolved.relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return resolved.as_posix()


def evaluate_screen(
    screen: str,
    reference_path: Path,
    runtime_path: Path,
    *,
    ui_frame: str = "auto",
) -> tuple[dict[str, object], np.ndarray, np.ndarray, np.ndarray]:
    with Image.open(reference_path) as handle:
        reference_image = handle.convert("RGB")
    with Image.open(runtime_path) as handle:
        runtime_image = handle.convert("RGB")

    ref_size = reference_image.size
    run_size = runtime_image.size
    ref_full = np.array(reference_image)
    run_full = np.array(runtime_image)

    ui_elements = load_ui_layout(screen, reference_path)
    ui_block, chosen_boxes = score_ui(ref_full, run_full, ui_elements, ui_frame)

    overlap = compute_overlap(ref_size, run_size)
    canvas = working_size(ref_size)
    cropped = runtime_image.crop(
        (
            overlap.left,
            overlap.top,
            overlap.left + overlap.width,
            overlap.top + overlap.height,
        )
    )
    reference_array = _resize(reference_image, canvas)
    runtime_array = _resize(cropped, canvas)

    mask = build_scene_mask_working(
        reference_array.shape, ref_size, run_size, ui_elements, chosen_boxes
    )
    scene_block = score_scene(reference_array, runtime_array, mask)
    legacy_block = compare_legacy(reference_array, runtime_array)

    overall = (
        0.45 * float(scene_block["sceneStructure"])
        + 0.20 * float(scene_block["sceneColor"])
        + 0.20 * float(ui_block["uiPlacement"])
        + 0.15 * float(ui_block["uiContent"])
    )

    checks = {
        "sceneStructure": float(scene_block["sceneStructure"]) >= GATE_THRESHOLDS["sceneStructure"],
        "sceneColor": float(scene_block["sceneColor"]) >= GATE_THRESHOLDS["sceneColor"],
        "uiPlacement": float(ui_block["uiPlacement"]) >= GATE_THRESHOLDS["uiPlacement"],
        "uiContent": float(ui_block["uiContent"]) >= GATE_THRESHOLDS["uiContent"],
        "overallScore": overall >= GATE_THRESHOLDS["overallScore"],
    }

    report = {
        "schema": SCHEMA,
        "algorithmVersion": ALGORITHM_VERSION,
        "screen": screen,
        "reference": {"path": _report_path(reference_path), "width": ref_size[0], "height": ref_size[1]},
        "runtime": {"path": _report_path(runtime_path), "width": run_size[0], "height": run_size[1]},
        "workingCanvas": {"width": canvas[0], "height": canvas[1]},
        "thresholds": GATE_THRESHOLDS,
        "gate": {"passed": all(checks.values()), "checks": checks, "overallScore": overall},
        "scene": scene_block,
        "ui": ui_block,
        "legacy": legacy_block,
    }
    return report, reference_array, runtime_array, mask


def format_report(report: dict[str, object], *, show_legacy: bool = False) -> str:
    gate = report["gate"]
    scene = report["scene"]
    ui = report["ui"]
    legacy = report["legacy"]
    status = "PASS" if gate["passed"] else "FAIL"
    lines = [
        f"=== [{status}] screen={report['screen']}  OVERALL={gate['overallScore']:.2f} (bar >= {GATE_THRESHOLDS['overallScore']:.1f}) ===",
        f"  Scene Structure : {scene['sceneStructure']:6.2f}  (bar >= {GATE_THRESHOLDS['sceneStructure']:.1f}) "
        f"[cov={scene['multiScaleEdgeCoverage']:.1f} dist12x8={scene['multiScaleDistribution12x8']:.1f} "
        f"hog={scene['hogOrientationSimilarity']:.1f} ssim={scene['coarseContrastSsim']:.1f}]",
        f"  Scene Color     : {scene['sceneColor']:6.2f}  (bar >= {GATE_THRESHOLDS['sceneColor']:.1f}) "
        f"[luma={scene['lumaSimilarity']:.1f} chroma={scene['chromaSimilarity']:.1f} hist={scene['lumaHistogramSimilarity']:.1f}]",
        f"  UI Placement    : {ui['uiPlacement']:6.2f}  (bar >= {GATE_THRESHOLDS['uiPlacement']:.1f}) [mode={ui['uiFrameMode']}]",
        f"  UI Content      : {ui['uiContent']:6.2f}  (bar >= {GATE_THRESHOLDS['uiContent']:.1f})",
        f"  Legacy Metric   : {legacy['structuralMetric']:6.2f}  (unmasked single-scale Canny)",
        "",
        "UI Elements (offset in runtime pixels):",
    ]
    for el in ui["elements"]:
        off = el["offsetPx"]
        lines.append(
            f"  {el['id']:16s} [{el['anchor']:13s} -> {el['matchedFrame']:4s}] "
            f"dx={off['dx']:+6.1f}px dy={off['dy']:+6.1f}px  "
            f"place={el['placementScore']:5.1f}  content={el['contentScore']:5.1f}"
        )

    if show_legacy:
        lines.append("")
        lines.append("6x4 Cell Edge Density Ratio (runtime / reference):")
        cells = {(c["row"], c["column"]): c for c in legacy["cells"]}
        for r in range(GRID_ROWS):
            row_txt = "".join(
                f"  {cells[(r, c)]['ratioPercent']:6.1f}%"
                if cells[(r, c)]["ratioPercent"] is not None
                else "     n/a"
                for c in range(GRID_COLUMNS)
            )
            lines.append(f"  row {r + 1}: {row_txt}")
    return "\n".join(lines)


def run_calibration() -> int:
    print("Running v2 Calibration Suite on artifacts/mockups/ashen-reliquary.png...")
    ref_img = Image.open(SCREEN_CONFIGS["crypt"]["reference"]).convert("RGB")
    ref_work = _resize(ref_img, (810, 540))
    mask = build_scene_mask_working(
        ref_work.shape, (1536, 1024), (1536, 1024), DEFAULT_UI_LAYOUTS["crypt"], []
    )
    rng = np.random.default_rng(42)

    buf = io.BytesIO()
    Image.fromarray(ref_work).save(buf, format="JPEG", quality=70)
    buf.seek(0)
    jpeg_70 = np.array(Image.open(buf).convert("RGB"))

    shuf = ref_work.copy()
    cells = [(r, c) for r in range(4) for c in range(6)]
    perm = rng.permutation(len(cells))
    h, w = ref_work.shape[:2]
    for idx, (r, c) in enumerate(cells):
        sr, sc = cells[perm[idx]]
        shuf[r * h // 4 : (r + 1) * h // 4, c * w // 6 : (c + 1) * w // 6] = ref_work[
            sr * h // 4 : (sr + 1) * h // 4, sc * w // 6 : (sc + 1) * w // 6
        ]

    cases = [
        ("Perturb: 2px shift", np.roll(np.roll(ref_work, 2, axis=0), 2, axis=1), True),
        ("Perturb: 4px shift", np.roll(np.roll(ref_work, 4, axis=0), -3, axis=1), True),
        ("Perturb: 1.0px blur", cv2.GaussianBlur(ref_work, (0, 0), 1.0), True),
        ("Perturb: JPEG q70", jpeg_70, True),
        ("Perturb: +10% exposure", np.clip(ref_work.astype(np.float32) * 1.10, 0, 255).astype(np.uint8), True),
        (
            "Fake: blur(s=6)+noise(s=14)",
            np.clip(cv2.GaussianBlur(ref_work, (0, 0), 6.0) + rng.normal(0, 14.0, ref_work.shape), 0, 255).astype(np.uint8),
            False,
        ),
        ("Fake: solid mean color", np.full_like(ref_work, ref_work.mean(axis=(0, 1)).astype(np.uint8)), False),
        ("Fake: shuffled 6x4 cells", shuf, False),
        ("Fake: R/B color swap", ref_work[:, :, ::-1].copy(), False),
        ("Cross: vs settings mock", _resize(Image.open(SCREEN_CONFIGS["settings"]["reference"]).convert("RGB"), (810, 540)), False),
        ("Cross: vs title mock", _resize(Image.open(SCREEN_CONFIGS["title"]["reference"]).convert("RGB"), (810, 540)), False),
    ]

    all_ok = True
    for name, cand, should_pass in cases:
        sc = score_scene(ref_work, cand, mask)
        leg = compare_legacy(ref_work, cand)["structuralMetric"]
        passed = (
            sc["sceneStructure"] >= GATE_THRESHOLDS["sceneStructure"]
            and sc["sceneColor"] >= GATE_THRESHOLDS["sceneColor"]
        )
        ok = passed == should_pass
        all_ok = all_ok and ok
        mark = "OK" if ok else "MISMATCH"
        print(
            f"  [{mark:8s}] {name:28s} | legacy={leg:5.1f} | v2_struct={sc['sceneStructure']:5.1f} | v2_col={sc['sceneColor']:5.1f} | gate={'PASS' if passed else 'FAIL'}"
        )
    return 0 if all_ok else 1


def parse_arguments(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Structure-, color-, and UI-aware visual fidelity gate."
    )
    parser.add_argument("reference", nargs="?", type=Path, default=None)
    parser.add_argument("runtime", nargs="?", type=Path, default=None)
    parser.add_argument(
        "--screen",
        choices=("title", "settings", "crypt"),
        default="title",
        help="screen preset for default paths and UI layout (default: title)",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="score all three screens (title, settings, crypt)",
    )
    parser.add_argument(
        "--ui-frame",
        choices=("auto", "edge", "safe"),
        default="auto",
        help="how 3:2 UI boxes map onto 16:9 runtime captures (default: auto)",
    )
    parser.add_argument("--out", type=Path, default=None, help="JSON report output path")
    parser.add_argument("--print", dest="print_report", action="store_true")
    parser.add_argument("--legacy", action="store_true", help="include 6x4 legacy cell table")
    parser.add_argument("--no-write", action="store_true")
    parser.add_argument("--no-fail", action="store_true", help="exit 0 even if gate fails")
    parser.add_argument("--calibrate", action="store_true", help="run calibration suite and exit")
    parser.add_argument(
        "--write-comparison",
        nargs="?",
        type=Path,
        const=Path("__default__"),
        default=None,
        metavar="PATH",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_arguments(argv)
    if args.calibrate:
        return run_calibration()

    screens = ["title", "settings", "crypt"] if args.all else [args.screen]
    overall_pass = True

    for screen in screens:
        cfg = SCREEN_CONFIGS[screen]
        ref_path = args.reference if (args.reference and not args.all) else cfg["reference"]
        run_path = args.runtime if (args.runtime and not args.all) else cfg["runtime"]
        out_path = args.out if (args.out and not args.all) else cfg["report"]

        for path in (ref_path, run_path):
            if not path.is_file():
                print(f"missing image for {screen}: {path}", file=sys.stderr)
                return 2

        report, ref_arr, run_arr, mask = evaluate_screen(
            screen, ref_path, run_path, ui_frame=args.ui_frame
        )
        overall_pass = overall_pass and bool(report["gate"]["passed"])

        if not args.no_write:
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_text(
                json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
            )

        if args.write_comparison is not None:
            comp_path = (
                cfg["comparison"]
                if args.write_comparison == Path("__default__") or args.all
                else args.write_comparison
            )
            comp_img = build_comparison_image(
                ref_arr, run_arr, mask, report["legacy"]["cells"]
            )
            Path(comp_path).parent.mkdir(parents=True, exist_ok=True)
            comp_img.save(comp_path)

        if args.print_report:
            print(format_report(report, show_legacy=args.legacy))
        else:
            status = "PASS" if report["gate"]["passed"] else "FAIL"
            print(
                f"[{status}] {screen}: overall={report['gate']['overallScore']:.2f} "
                f"(struct={report['scene']['sceneStructure']:.1f}, "
                f"color={report['scene']['sceneColor']:.1f}, "
                f"ui_place={report['ui']['uiPlacement']:.1f}, "
                f"ui_content={report['ui']['uiContent']:.1f})"
            )

    if not overall_pass and not args.no_fail:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
