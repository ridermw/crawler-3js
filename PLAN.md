# Session Plan: `crawler-3js` (*The Ashen Reliquary* — Three.js Edition)

## 1. Objective & Ground Rules
- **Repository**: `/Users/mattheww/git/crawler-3js` → public GitHub repo `https://github.com/ridermw/crawler-3js` (GitHub Pages enabled on `main`).
- **Git Identity**: `Matthew Williams <5863886+ridermw@users.noreply.github.com>`, pushed using the `ridermw` GitHub account.
- **Zero-Asset / Zero-Build Architecture** (modeled directly on `/Users/mattheww/Projects/fishing`):
  - Single-page ES module webapp using **Three.js r169** via CDN import map (`no bundler, no npm build step`).
  - **Every runtime texture, normal/roughness map, UI ornament, ability icon, 3D mesh, and sound effect is generated in code at startup** using a deterministic xorshift32 RNG so the entire project can subsequently be ported 1:1 to `RustCrawler` (just like `fishing` → `fishing-rs`).
- **Reference Authorities** (in `artifacts/mockups/`):
  1. `artifacts/mockups/ashen-reliquary-title.png` (+ `.mock.md`) — Title screen (`1920×1080` target capture).
  2. `artifacts/mockups/ashen-reliquary-settings.png` (+ `.mock.md`) — Settings screen (`1920×1080` target capture).
  3. `artifacts/mockups/ashen-reliquary.png` (+ `.mock.md`) — Playable combat arena (`1920×1080` target capture).
- **Automated Visual Gate**:
  - `tools/fidelity/compare-scene.py` scores runtime Playwright captures (`1920×1080`) against the three reference stills across the `6×4` cell grid (`structuralMetric`, `edgeDensityCoverage`, `edgeDistributionSimilarity`, `lowFrequencyComposition`, `pixelSimilarity`), targeting **≥ 90/100** acceptance.

---

## 2. File Structure (Mirroring `/Users/mattheww/Projects/fishing`)

```text
crawler-3js/
├── index.html                  # Three.js r169 import map + Cinzel/Inter fonts + DOM UI layers
├── style.css                   # Title, Settings, and ARPG Combat HUD styling (1920x1080 reference scale)
├── .nojekyll                   # GitHub Pages static serving
├── .gitignore                  # Ignore temporary validation captures if desired
├── PLAN.md                     # This session plan
├── README.md                   # Overview, controls, play link, architecture notes
├── src/
│   ├── main.js                 # Renderer, post-processing, camera poses, loop, URL query & telemetry hooks
│   ├── pixel.js                # Seeded xorshift32 RNG + procedural Canvas2D textures, normal maps & icons
│   ├── world.js                # Ruined cathedral crypt generator, lighting, candles, fog & props
│   ├── combat.js               # Knight player, Bone Warden boss, 3 Skeletal Thralls, abilities & VFX
│   ├── ui.js                   # Title/Settings/Crypt UI controller, draft settings & HUD bindings
│   └── audio.js                # WebAudio procedural dark-crypt drone ambience & combat SFX
├── artifacts/
│   └── mockups/                # The 3 reference PNGs + .mock.md specs (for local validation)
└── tools/
    └── fidelity/
        └── compare-scene.py    # OpenCV Canny 6x4 structural & edge-density scorer
```

---

## 3. Implementation Phases

### Phase 1: Bootstrap, Deterministic Harness & Camera Poses (`index.html`, `src/main.js`)
1. Set up `THREE.WebGLRenderer` (`ACESFilmicToneMapping`, `PCFSoftShadowMap` at `2048×2048`) and `EffectComposer`:
   - `RenderPass` → `UnrealBloomPass` (subtle threshold for candle flames & ability arcs) → custom `CryptGradePass` (cold-blue shadow / warm-amber highlight split-toning + vignette) → `OutputPass`.
2. Implement URL query parameters for deterministic testing and screenshot capture:
   - `?state=title|settings|crypt` — boots directly into that state.
   - `?freeze=1` — freezes all animations (candle flicker, ember drift, camera drift, combat timers) at the exact reference keyframe so Playwright captures are 100% deterministic.
   - Expose `window.__crawler` JSON telemetry (`state`, `hp`, `essence`, `bossHp`, `cooldowns`, `selectedMenu`, `settings`).
3. Define the 3 orthographic camera poses matching the 3 stills:
   - **Title Pose**: `35°` pitch, `45°` yaw, framed closer to the upper-middle candle-lit altar with open flagstones at lower-left for the title block.
   - **Settings Pose**: `26°` pitch, `8°` yaw, shifted so the altar and gothic tabernacle frame the right half of the viewport while the Settings panel sits on the left.
   - **Crypt Gameplay Pose**: `35°` pitch, `0°` yaw, symmetric wide framing of the cruciform combat arena.

### Phase 2: Procedural PBR Textures, Bump Maps & UI Icons (`src/pixel.js`)
1. Build a deterministic `rng(seed)` (same xorshift32 as `fishing/src/pixel.js`) so every texture can later be ported 1:1 to `RustCrawler`.
2. Generate paired **Albedo + Height/Normal + Roughness** `CanvasTexture`s:
   - **Cracked Flagstones**: Voronoi multi-cell stone slabs with chiseled mortar seams, cracks, and surface pitting (essential for matching the reference Canny edge density across the floor).
   - **Carved Gothic Masonry & Relief**: Recessed gothic panels, tracery arches, and weathered stone blocks for pillars, balustrades, and the altar plinth.
   - **Rusted Iron Grate**: Transparent alpha cutout cross-bars with metallic/roughness variation.
   - **Tattered Black/Gold Banner Cloth**: Alpha-frayed edges with subtle gold gothic insignia (`title` and `settings`/`crypt` variants).
   - **Gothic Lancet Window Tracery**: Stone mullions with cold emissive moonlight backing.
3. Generate the **Canvas 2D UI Rasters**:
   - Chiseled serif `"THE ASHEN RELIQUARY"` title lockup, brass diamond divider, and pale-gold menu marker.
   - The 5 square ability icons (`1: Greatsword Cleave`, `2: Shield Bash`, `3: Shadow Lunge`, `4: Consecration Ward`, `Q: Crimson Vial`) + `Rusted Reliquary Key` icon + ornate brass-rimmed Health/Essence glass orbs.

### Phase 3: Procedural Cathedral Crypt & Lighting (`src/world.js`)
Build the environment to satisfy the `6×4` cell edge-density targets of all three reference stills:
1. **Floor & Foreground**:
   - Jittered, beveled flagstone grid with height settle and procedural bump maps.
   - Recessed iron floor grates (`row 3–4` left and right-center), scattered rubble clusters, and ossuary bone/skull piles along pillar bases and wall edges.
2. **Altar Sanctum (Upper Center)**:
   - Stepped octagonal/rectangular stone dais with worn carpet runner.
   - Carved stone altar block with relief panels, flanked by side pillars/candlesticks and topped with the gothic reliquary tabernacle, plus 50+ wax candles with emissive flickering flames and wax drips.
3. **Framing Architecture (Left, Right & Upper Vault)**:
   - 4 heavy square carved stone pillars hung with tattered black/gold banners and catenary iron chains.
   - Broken crenellated rear crypt walls with glowing moonlit Gothic lancet windows (`row 1 cols 2–5`).
   - Right-side gothic alcove, hanging iron brazier cage, and fallen column (`col 6`, solving `bevy-crawler`'s `2.4%` empty-column deficit).
   - Stepped stone balustrades framing the left and right flanks of the combat arena.
4. **Lighting & Ground Fog**:
   - Cold desaturated blue directional moonlight (`#8BA7B8`) from upper-left + upper-vault volumetric mist/haze planes.
   - Warm candle amber point lights (`#D69A45`) clustered over the altar and side sconces.
   - Low ground-hugging mist planes drifting over the cold outer flagstones.

### Phase 4: UI Layers — Title, Settings & Combat HUD (`index.html`, `style.css`, `src/ui.js`)
1. **Title Screen**: Left-of-center lockup, brass diamond divider, `"DESCEND. END THE WARDEN."`, `"ENTER THE CRYPT"` / `"SETTINGS"` / `"QUIT"` with pale-gold marker, `"CLICK OR PRESS ENTER"`, and bottom safe-margin footers (`"A THREE.JS PROOF OF CONCEPT"` / `"v0.1"`).
2. **Settings Screen**: Translucent obsidian panel (`38%` width, `62%` height, `1px` brass border) with `AUDIO` (`MASTER VOLUME 80%`, `AMBIENT VOLUME 65%` diamond-thumb sliders), `DISPLAY` (`WINDOWED`/`BORDERLESS` selector, `CAMERA DRIFT ON`, `VIGNETTE ON` diamond toggles), and `APPLY` / `BACK` with draft commit/discard behavior.
3. **Combat HUD**: Top-left `"ASHEN RELIQUARY"` + `"Destroy the Bone Warden."` objective; top-center `"BONE WARDEN"` `63%` crimson bar; top-right cruciform minimap (with gold altar diamond, white player chevron, 3 red enemy dots); bottom-left `82 / 100` crimson orb; bottom-right `46 / 75` cobalt orb + `"Rusted Reliquary Key"` toast; bottom-center 5-slot ability bar (`1, 2, 3, 4, Q`) with cooldown wedges on slots `2` and `3`.

### Phase 5: Playable Combat & Freeze-Frame Pose (`src/combat.js`, `src/audio.js`)
1. **Characters & Default Freeze Pose** (when `?state=crypt&freeze=1`, matches Still 3's exact combat snapshot):
   - **Grave Warden Knight** at center-below (`(-0.15, 0, 0.18)`) in recovery frame of a wide greatsword slash, with a glowing pale-gold cleave trail arc, impact spark, dust burst, floating red `18` damage number, and golden mouse destination ring/arrow ahead on the floor.
   - **Bone Warden** elite at upper-left-center (`63%` HP) with horned crown, tattered robes, raised glowing crimson staff, and red runic floor ring.
   - **3 Skeletal Thralls**: one recoiling on the right of the Knight's slash, one advancing from the upper-left bay, one near the right altar steps.
2. **Live Gameplay Loop** (when not frozen):
   - WASD + Left-Click floor raycast movement; keys `1, 2, 3, 4, Q` and Right-Click/Space trigger abilities with cooldown sweeps, essence cost, screen shake, floating damage numbers, and WebAudio synthesized SFX (`src/audio.js`).

### Phase 6: Visual Validation Loop & GitHub Pages Deployment
1. Serve locally (`python3 -m http.server 8000`), capture `1920×1080` screenshots via Playwright for:
   - `http://localhost:8000/?state=title&freeze=1` → compare against `artifacts/mockups/ashen-reliquary-title.png`
   - `http://localhost:8000/?state=settings&freeze=1` → compare against `artifacts/mockups/ashen-reliquary-settings.png`
   - `http://localhost:8000/?state=crypt&freeze=1` → compare against `artifacts/mockups/ashen-reliquary.png`
2. Run `python3 tools/fidelity/compare-scene.py --print --write-comparison` on each capture, inspect the `6×4` cell deficit table and side-by-side comparison PNGs, and tune geometry/textures/lighting until all three screens pass the visual & structural bar.
3. Exercise the full interactive loop in Playwright (Title → Settings → toggle/apply → Enter the Crypt → move & cast abilities `1, 2, 3, 4, Q` → defeat Bone Warden → Esc back to Title) with zero console errors.
4. Create the public repo `ridermw/crawler-3js`, push `main`, enable GitHub Pages, and verify the live deployment.
