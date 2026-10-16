# Visual Fidelity Gate v2 (`tools/fidelity/compare-scene.py`)

## 1. Diagnosis of the Legacy Gate

Measuring the legacy single-scale Canny scorer against `artifacts/mockups/ashen-reliquary*.png` confirmed five structural flaws:

1. **Noise passes the gate**: Blurring `ashen-reliquary.png` ($\sigma = 6.0$) and adding Gaussian pixel noise ($\sigma = 14.0$) destroys all pillars, characters, and flagstones yet scores **`85.20`** on the legacy structural metric (`70.9%` coverage, `91.3%` distribution).
2. **UI and 3D Scene are confounded**: UI boxes hold **`12.4%`** of Canny edges on `title` (`10.0%` area), **`18.0%`** on `settings` (`30.0%` area), and **`15.9%`** on `crypt` (`18.8%` area).
3. **3:2 (`1536×1024`) vs. 16:9 (`1920×1080`) HUD distortion**: Cropping a `1920×1080` capture to the central `1620×1080` region cuts off HUD widgets anchored to the real `16:9` screen edges unless the developer artificially insets the HUD by `150 px` per side.
4. **Color and lighting temperature are ignored**: Swapping the Red and Blue channels (turning warm amber candles blue and cold moonlight orange) scores **`99.8`** on the legacy metric.
5. **Narrow cross-screen separation**: `crypt` vs. `settings` scores `73.26` on the legacy metric.

---

## 2. Calibration Table (Legacy vs. v2)

Run `python3 tools/fidelity/compare-scene.py --calibrate` to reproduce this table deterministically:

| Test Case (on `ashen-reliquary.png`) | Expected | Legacy `structuralMetric` | v2 `sceneStructure` (bar $\ge 75$) | v2 `sceneColor` (bar $\ge 80$) | Gate Result |
| :--- | :---: | ---: | ---: | ---: | :---: |
| **Perturb: 2px shift** | PASS | 96.8 | **97.2** | **99.2** | **PASS** |
| **Perturb: 4px shift** | PASS | 95.1 | **94.9** | **98.3** | **PASS** |
| **Perturb: 1.0px Gaussian blur** | PASS | 79.4 | **91.6** | **98.9** | **PASS** |
| **Perturb: JPEG quality 70** | PASS | 96.9 | **97.6** | **96.4** | **PASS** |
| **Perturb: +10% exposure** | PASS | 84.2 | **97.1** | **94.8** | **PASS** |
| **Fake: blur($\sigma=6$) + noise($\sigma=14$)** | FAIL | 85.2 | **49.2** | 91.2 | **FAIL** |
| **Fake: solid mean color** | FAIL | 42.0 | **26.9** | **67.5** | **FAIL** |
| **Fake: shuffled 6×4 cells** | FAIL | 68.4 | **56.3** | **59.3** | **FAIL** |
| **Fake: R/B color swap** | FAIL | 99.8 | 95.1 | **70.7** | **FAIL** |
| **Cross: vs `settings` mock** | FAIL | 73.3 | **57.0** | **63.9** | **FAIL** |
| **Cross: vs `title` mock** | FAIL | 63.6 | **53.8** | **69.9** | **FAIL** |

---

## 3. Sub-Score Definitions & Pass Bars

1. **`sceneStructure` (bar $\ge 75.0$, weight `0.45`)** — Evaluated on the `3:2` overlap crop (`810×540`) with all UI boxes masked out:
   - `30%` Multi-scale pre-smoothed Canny edge coverage ($\sigma_1 = 2.0, \sigma_2 = 3.5$, normalized by 95th-percentile luma).
   - `25%` Multi-scale `12×8` edge distribution similarity.
   - `25%` `12×8` Sobel gradient orientation histogram (HOG, 8 unsigned bins with noise floor subtraction).
   - `20%` Coarse contrast-structure SSIM (`135×90` grid after $\sigma = 3.5$ blur).
2. **`sceneColor` (bar $\ge 80.0$, weight `0.20`)** — Evaluated in CIE Lab across the UI-masked `6×4` cells:
   - `30%` Mean cell luminance ($L^*$) similarity.
   - `45%` Mean cell chroma ($a^*, b^*$) Euclidean similarity (verifies warm candle amber vs. cold blue moonlight).
   - `25%` Per-cell 8-bin luminance histogram intersection.
3. **`uiPlacement` (bar $\ge 85.0$, weight `0.20`)** — Evaluated per element from `artifacts/mockups/<name>.layout.json`:
   - Compares edge/ink center-of-mass $(\mu_x, \mu_y)$ and spread $(\sigma_x, \sigma_y)$ inside each element's anchor-mapped runtime box, reporting `dx`/`dy` pixel offsets.
   - Supports `--ui-frame auto|edge|safe` (`auto` evaluates both `16:9` edge-anchored and `3:2` safe-frame coordinates per element and picks the better match, so `16:9` edge-anchored HUDs are never penalized).
4. **`uiContent` (bar $\ge 78.0$, weight `0.15`)** — Edge coverage, `4×2` sub-grid edge distribution, and Lab color similarity per UI box (with `tolerant_text: true` on `footer_left` and `loot_toast`).
5. **`overallScore` (bar $\ge 82.0$)**:
   $$\text{Overall} = 0.45 \cdot \text{sceneStructure} + 0.20 \cdot \text{sceneColor} + 0.20 \cdot \text{uiPlacement} + 0.15 \cdot \text{uiContent}$$

---

## 4. CLI Usage

```sh
# Run the self-calibration suite
python3 tools/fidelity/compare-scene.py --calibrate

# Score a single screen (defaults to artifacts/validation/ashen-reliquary-<screen>-runtime.png)
python3 tools/fidelity/compare-scene.py --screen title --print --legacy --write-comparison
python3 tools/fidelity/compare-scene.py --screen settings --print --legacy --write-comparison
python3 tools/fidelity/compare-scene.py --screen crypt --print --legacy --write-comparison

# Score all three screens at once
python3 tools/fidelity/compare-scene.py --all --print --write-comparison
```
