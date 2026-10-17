# Positive controls for the v2 fidelity gate

Each `*-control-v{1,2}.png` is an **independent re-render of the same approved prompt**
(`artifacts/mockups/<screen>.mock.md`) with the same image model that made the reference
(`mockui render --model sunburst -q high --size 1536x1024`). They satisfy the brief as well as
the reference does, but are not pixel copies of it, which makes them a ceiling estimate for what
a faithful but independently built screen can score.

| Screen | Image | Overall | Scene structure | Scene colour | UI placement | UI content |
|---|---|---|---|---|---|---|
| title | control v1 | 55.4 | 48.4 | 75.1 | 47.7 | 60.5 |
| title | control v2 | 57.4 | 50.7 | 77.4 | 50.1 | 60.6 |
| title | **runtime `1a369db`** | **79.1** | **75.3** | 76.7 | 85.0 | 85.6 |
| settings | control v1 | 71.8 | 64.1 | 63.1 | 91.6 | 79.7 |
| settings | control v2 | 66.9 | 59.8 | 59.0 | 88.0 | 70.8 |
| settings | **runtime `1a369db`** | **83.5** | **74.7** | 81.6 | 95.3 | 96.8 |
| crypt | control v1 | 69.2 | 58.5 | 62.1 | 87.1 | 86.6 |
| crypt | control v2 | 73.7 | 60.2 | 80.0 | 87.1 | 88.1 |
| crypt | **runtime `1a369db`** | **78.5** | **69.6** | 86.3 | 88.3 | 81.5 |

Scored with `tools/fidelity/compare-scene.py` (v2, `--ui-frame auto`) against `artifacts/mockups/`.
The controls score 48–64 on scene structure, well short of the bar of 75, so that bar
measures closeness to one particular image rather than faithfulness to the design.
