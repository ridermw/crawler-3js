#!/usr/bin/env python3
"""Structural comparison of the Ashen Reliquary runtime capture against the mock.

This tool scores the *rendered crypt scene*, not the individual rasters. The
per-component raster gate lives in ``tools/asset-review/score-candidates.py``
and is unrelated.

Overlap cropping
----------------

The approved mock is ``1536x1024`` (3:2). The runtime window is ``1920x1080``
(16:9). Height-fitting the mock into the runtime frame covers ``1620x1080`` and
leaves a ``150``-pixel band on each side with no corresponding reference pixel.

Earlier reviews aspect-fit both images into a padded ``960x540`` panel, so every
metric was computed partly against black padding on the reference side and
partly against unreferenced content on the runtime side. This tool crops the
runtime to the overlapping region first, then resizes both images to the same
working canvas. Only overlapping content is scored.

Pass ``--full-frame`` to reproduce the legacy padded method for comparison. It
exists so a reader can confirm what the crop changes; it is not the gate.

Metrics
-------

The metric definitions are unchanged from the published review, so numbers
remain comparable across the crop change:

1. Pixel similarity is ``100 * (1 - mean(abs(reference - runtime)) / 255)``.
2. Low-frequency composition similarity applies a Gaussian blur with sigma
   ``12`` before the same normalised mean absolute error.
3. Structural edges use grayscale Canny thresholds ``25/70``.
4. Edge-density coverage is the lower total edge density divided by the higher.
5. Edge-distribution similarity divides each edge map into a fixed ``6x4`` grid,
   normalises each 24-cell density vector to sum to one, and computes
   ``100 * (1 - 0.5 * L1 distance)``.
6. The structural metric is
   ``0.70 * edge-distribution similarity + 0.30 * edge-density coverage``.

Pixel similarity and the blurred score are dominated by shared dark pixels.
They are reported as diagnostics and are not an acceptance signal.

Per-cell deficit map
--------------------

The same ``6x4`` grid also reports each cell's runtime-to-reference edge ratio
and absolute deficit. A ratio far below 100 marks a region missing authored
detail. A ratio far above 100 marks a region where untextured hard-edged
geometry produces more edges than the painted reference, so adding detail there
moves the score the wrong way.

The report contains no timestamps, so repeated runs are byte-for-byte identical.

Usage (from the repository root)::

    python tools/fidelity/compare-scene.py
    python tools/fidelity/compare-scene.py --print
    python tools/fidelity/compare-scene.py --full-frame --print
    python tools/fidelity/compare-scene.py --out some/other/report.json

Explicit positional paths override the documented defaults::

    python tools/fidelity/compare-scene.py \
        artifacts/mockups/ashen-reliquary-title.png \
        artifacts/validation/ashen-reliquary-title-runtime.png

Requires Python 3.12, Pillow, NumPy and OpenCV. OpenCV is required because the
published metric is defined in terms of its Canny and Gaussian implementations;
a reimplementation would not reproduce the committed numbers.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

try:
    import cv2
except ModuleNotFoundError:  # pragma: no cover - exercised only without OpenCV.
    print(
        "compare-scene.py requires OpenCV. Install it with:\n"
        "    python -m pip install opencv-python-headless",
        file=sys.stderr,
    )
    raise SystemExit(2)

# ---------------------------------------------------------------------
# Algorithm constants. These reproduce the published review metric.
# ---------------------------------------------------------------------

SCHEMA = "ashen-reliquary-scene-fidelity/v1"
ALGORITHM_VERSION = "1.0.0"

CANNY_LOW = 25
CANNY_HIGH = 70
BLUR_SIGMA = 12.0
GRID_COLUMNS = 6
GRID_ROWS = 4
DISTRIBUTION_WEIGHT = 0.70
DENSITY_WEIGHT = 0.30

#: Both images are resized to this height before scoring. The width follows the
#: reference aspect ratio, so neither image is stretched.
WORKING_HEIGHT = 540

#: Legacy padded panel used by ``--full-frame``, with the matte the earlier
#: reviews used. Pure black would change the padding boundary's Canny response.
LEGACY_PANEL = (960, 540)
LEGACY_MATTE = (11, 13, 16)

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_REFERENCE = REPO_ROOT / "artifacts" / "mockups" / "ashen-reliquary-title.png"
DEFAULT_RUNTIME = (
    REPO_ROOT / "artifacts" / "validation" / "ashen-reliquary-title-runtime.png"
)
DEFAULT_REPORT = (
    REPO_ROOT / "artifacts" / "validation" / "ashen-reliquary-scene-fidelity.json"
)
DEFAULT_COMPARISON = (
    REPO_ROOT / "artifacts" / "validation" / "ashen-reliquary-title-comparison.png"
)


@dataclass(frozen=True)
class Overlap:
    """The region of the runtime frame that the reference actually covers."""

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
    """Return the centred runtime crop matching the reference aspect ratio.

    The reference is fitted to whichever runtime axis is fully covered, so the
    crop never invents pixels outside the runtime frame.
    """
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
    """Return the common canvas both images are scored on."""
    reference_width, reference_height = reference_size
    width = int(round(WORKING_HEIGHT * reference_width / reference_height))
    return width, WORKING_HEIGHT


def _resize(image: Image.Image, size: tuple[int, int]) -> np.ndarray:
    return np.array(image.resize(size, Image.Resampling.LANCZOS))


def _legacy_panel_image(image: Image.Image) -> Image.Image:
    """Aspect-fit into a matte-padded panel, reproducing the earlier reviews.

    The matte is ``LEGACY_MATTE``, not pure black. Black would change the
    padding boundary's Canny response and shift every structural number.
    """
    fitted = image.copy()
    fitted.thumbnail(LEGACY_PANEL, Image.Resampling.LANCZOS)
    panel = Image.new("RGB", LEGACY_PANEL, LEGACY_MATTE)
    panel.paste(
        fitted,
        ((LEGACY_PANEL[0] - fitted.width) // 2, (LEGACY_PANEL[1] - fitted.height) // 2),
    )
    return panel


def _legacy_panel(image: Image.Image) -> np.ndarray:
    return np.array(_legacy_panel_image(image))


def build_comparison_image(reference_path: Path, runtime_path: Path) -> Image.Image:
    """Build the side-by-side review image: reference left, runtime right.

    Each side is aspect-fit into a 960x540 panel over ``LEGACY_MATTE``, so the
    output is 1920x540. This reproduces the committed comparison artifact
    byte-for-byte.
    """
    with Image.open(reference_path) as handle:
        left = _legacy_panel_image(handle.convert("RGB"))
    with Image.open(runtime_path) as handle:
        right = _legacy_panel_image(handle.convert("RGB"))
    comparison = Image.new("RGB", (LEGACY_PANEL[0] * 2, LEGACY_PANEL[1]), LEGACY_MATTE)
    comparison.paste(left, (0, 0))
    comparison.paste(right, (LEGACY_PANEL[0], 0))
    return comparison


def edge_map(image: np.ndarray) -> np.ndarray:
    """Return the boolean Canny edge map used by every structural metric."""
    grayscale = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    return cv2.Canny(grayscale, CANNY_LOW, CANNY_HIGH) > 0


def cell_bounds(shape: tuple[int, int]) -> list[tuple[int, int, int, int, int, int]]:
    """Return ``(row, column, top, bottom, left, right)`` for every grid cell."""
    height, width = shape
    bounds = []
    for row in range(GRID_ROWS):
        for column in range(GRID_COLUMNS):
            bounds.append(
                (
                    row,
                    column,
                    row * height // GRID_ROWS,
                    (row + 1) * height // GRID_ROWS,
                    column * width // GRID_COLUMNS,
                    (column + 1) * width // GRID_COLUMNS,
                )
            )
    return bounds


def distribution_vector(edges: np.ndarray) -> np.ndarray:
    """Return the 24-cell edge-density vector, normalised to sum to one."""
    densities = np.array(
        [
            edges[top:bottom, left:right].mean()
            for _, _, top, bottom, left, right in cell_bounds(edges.shape)
        ],
        dtype=np.float64,
    )
    total = densities.sum()
    if total == 0:
        return np.full(densities.size, 1.0 / densities.size)
    return densities / total


def _normalised_similarity(first: np.ndarray, second: np.ndarray) -> float:
    error = float(np.mean(np.abs(first.astype(np.float64) - second.astype(np.float64))))
    return 100.0 * (1.0 - error / 255.0)


def compare(reference: np.ndarray, runtime: np.ndarray) -> dict[str, object]:
    """Score two same-sized RGB arrays and return the metric block."""
    if reference.shape != runtime.shape:
        raise ValueError(
            f"scored images must match: {reference.shape} vs {runtime.shape}"
        )

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
    coverage = 100.0 * (min(reference_density, runtime_density) / highest) if highest else 100.0

    distribution = 100.0 * (
        1.0
        - 0.5
        * float(
            np.abs(
                distribution_vector(reference_edges) - distribution_vector(runtime_edges)
            ).sum()
        )
    )
    structural = DISTRIBUTION_WEIGHT * distribution + DENSITY_WEIGHT * coverage

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


def _report_path(path: Path) -> str:
    """Return a repository-relative path so reports do not embed machine paths."""
    resolved = path.resolve()
    try:
        return resolved.relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return resolved.as_posix()


def build_report(
    reference_path: Path, runtime_path: Path, *, full_frame: bool
) -> dict[str, object]:
    with Image.open(reference_path) as handle:
        reference_image = handle.convert("RGB")
    with Image.open(runtime_path) as handle:
        runtime_image = handle.convert("RGB")

    reference_size = reference_image.size
    runtime_size = runtime_image.size

    if full_frame:
        reference_array = _legacy_panel(reference_image)
        runtime_array = _legacy_panel(runtime_image)
        overlap_block: dict[str, object] = {
            "method": "full-frame",
            "note": (
                "Legacy padded comparison. Both images are aspect-fit into a "
                "black-padded 960x540 panel, so the reference contributes "
                "padding and the runtime contributes unreferenced side bands."
            ),
        }
        canvas = LEGACY_PANEL
    else:
        overlap = compute_overlap(reference_size, runtime_size)
        canvas = working_size(reference_size)
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
        overlap_block = {
            "method": "overlap",
            "cropWidth": overlap.width,
            "cropHeight": overlap.height,
            "cropLeft": overlap.left,
            "cropTop": overlap.top,
            "bandWidthPerSide": overlap.band_width,
            "bandHeightPerSide": overlap.band_height,
            "coveragePercentOfRuntimeWidth": 100.0 * overlap.width / runtime_size[0],
            "note": (
                "Only the region the reference covers is scored. The side bands "
                "carry no reference pixels and are excluded."
            ),
        }

    return {
        "schema": SCHEMA,
        "algorithmVersion": ALGORITHM_VERSION,
        "reference": {
            "path": _report_path(reference_path),
            "width": reference_size[0],
            "height": reference_size[1],
        },
        "runtime": {
            "path": _report_path(runtime_path),
            "width": runtime_size[0],
            "height": runtime_size[1],
        },
        "overlap": overlap_block,
        "workingCanvas": {"width": canvas[0], "height": canvas[1]},
        "parameters": {
            "cannyLow": CANNY_LOW,
            "cannyHigh": CANNY_HIGH,
            "blurSigma": BLUR_SIGMA,
            "gridColumns": GRID_COLUMNS,
            "gridRows": GRID_ROWS,
            "distributionWeight": DISTRIBUTION_WEIGHT,
            "densityWeight": DENSITY_WEIGHT,
        },
        "metrics": compare(reference_array, runtime_array),
    }


def format_report(report: dict[str, object]) -> str:
    metrics = report["metrics"]
    overlap = report["overlap"]
    lines: list[str] = []

    lines.append(f"method: {overlap['method']}")
    if overlap["method"] == "overlap":
        lines.append(
            f"  scored region {overlap['cropWidth']}x{overlap['cropHeight']} "
            f"at x={overlap['cropLeft']} "
            f"({overlap['coveragePercentOfRuntimeWidth']:.1f}% of runtime width); "
            f"{overlap['bandWidthPerSide']} px dropped per side"
        )
    lines.append("")

    for label, key in (
        ("pixel similarity", "pixelSimilarity"),
        ("low-frequency composition", "lowFrequencyComposition"),
        ("reference edge density", "referenceEdgeDensity"),
        ("runtime edge density", "runtimeEdgeDensity"),
        ("edge-density coverage", "edgeDensityCoverage"),
        ("edge-distribution 6x4", "edgeDistributionSimilarity"),
        ("STRUCTURAL METRIC", "structuralMetric"),
    ):
        lines.append(f"  {label:28s} {metrics[key]:.6f}")

    lines.append("")
    lines.append("Edge density per cell, runtime as a percentage of reference:")
    header = "  row " + "".join(f"  col{column + 1:<4d}" for column in range(GRID_COLUMNS))
    lines.append(header)
    cells = {(cell["row"], cell["column"]): cell for cell in metrics["cells"]}
    for row in range(GRID_ROWS):
        entries = []
        for column in range(GRID_COLUMNS):
            ratio = cells[(row, column)]["ratioPercent"]
            entries.append("     n/a" if ratio is None else f"  {ratio:6.1f}%")
        lines.append(f"  {row + 1:<3d} " + "".join(entries))

    lines.append("")
    lines.append("Largest absolute edge deficits (reference minus runtime):")
    ranked = sorted(metrics["cells"], key=lambda cell: cell["deficit"], reverse=True)
    for cell in ranked[:8]:
        ratio = cell["ratioPercent"]
        ratio_text = "n/a" if ratio is None else f"{ratio:5.1f}%"
        lines.append(
            f"  row {cell['row'] + 1} col {cell['column'] + 1}"
            f"  ref={cell['referenceEdgeDensity']:.6f}"
            f"  run={cell['runtimeEdgeDensity']:.6f}"
            f"  ratio={ratio_text}"
            f"  deficit={cell['deficit']:.6f}"
        )
    return "\n".join(lines)


def parse_arguments(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Compare the Ashen Reliquary runtime capture against the approved "
            "mock over the overlapping region only."
        )
    )
    parser.add_argument(
        "reference", nargs="?", type=Path, default=DEFAULT_REFERENCE,
        help="approved mock image (default: artifacts/mockups/ashen-reliquary-title.png)",
    )
    parser.add_argument(
        "runtime", nargs="?", type=Path, default=DEFAULT_RUNTIME,
        help="runtime capture (default: artifacts/validation/ashen-reliquary-title-runtime.png)",
    )
    parser.add_argument(
        "--out", type=Path, default=DEFAULT_REPORT, help="JSON report output path"
    )
    parser.add_argument(
        "--print", dest="print_report", action="store_true",
        help="print the human-readable table to stdout",
    )
    parser.add_argument(
        "--full-frame", action="store_true",
        help="reproduce the legacy padded comparison instead of cropping to the overlap",
    )
    parser.add_argument(
        "--no-write", action="store_true", help="skip writing the JSON report"
    )
    parser.add_argument(
        "--write-comparison", nargs="?", type=Path, const=DEFAULT_COMPARISON,
        default=None, metavar="PATH",
        help=(
            "also write the 1920x540 side-by-side review image "
            "(default: artifacts/validation/ashen-reliquary-title-comparison.png)"
        ),
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    arguments = parse_arguments(argv)
    for path in (arguments.reference, arguments.runtime):
        if not path.is_file():
            print(f"missing image: {path}", file=sys.stderr)
            return 2

    report = build_report(
        arguments.reference, arguments.runtime, full_frame=arguments.full_frame
    )

    if not arguments.no_write:
        arguments.out.parent.mkdir(parents=True, exist_ok=True)
        arguments.out.write_text(
            json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )

    if arguments.write_comparison is not None:
        comparison = build_comparison_image(arguments.reference, arguments.runtime)
        arguments.write_comparison.parent.mkdir(parents=True, exist_ok=True)
        comparison.save(arguments.write_comparison)

    if arguments.print_report:
        print(format_report(report))
    else:
        print(f"structural metric: {report['metrics']['structuralMetric']:.6f}")
        if not arguments.no_write:
            print(f"report: {_report_path(arguments.out)}")
    if arguments.write_comparison is not None:
        print(f"comparison: {_report_path(arguments.write_comparison)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
