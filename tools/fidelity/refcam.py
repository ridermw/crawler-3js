"""Fitted reference camera for the crypt mock (1536x1024 frame) and ray helpers.

The runtime crypt pose is target (0, 0, 3.44), pitch 37.3, yaw 0, vertical fov 36.9, view height
16.69 at the target; the 3:2 reference covers the full vertical extent of a 16:9 frame.
"""
import numpy as np

W, H = 1536, 1024
TARGET = np.array([0.0, 0.0, 3.44]); PITCH = np.radians(37.3); FOV = np.radians(36.9); HEIGHT = 16.69
D = (HEIGHT / 2) / np.tan(FOV / 2)
EYE = TARGET + np.array([0.0, np.sin(PITCH) * D, np.cos(PITCH) * D])
F = (H / 2) / np.tan(FOV / 2)
FWD = (TARGET - EYE) / np.linalg.norm(TARGET - EYE)
RIGHT = np.array([1.0, 0, 0]); UP = np.cross(RIGHT, FWD)


def rays(w=W, h=H):
    """Unit world-space ray directions for every pixel centre of a w x h image of the frame."""
    s = W / w
    u = (np.arange(w) + 0.5) * s - W / 2
    v = (np.arange(h) + 0.5) * s - H / 2
    uu, vv = np.meshgrid(u, v)
    d = FWD[None, None] * F + RIGHT[None, None] * uu[..., None] - UP[None, None] * vv[..., None]
    return d / np.linalg.norm(d, axis=-1, keepdims=True)


def floor_distance(w=W, h=H, y=0.0):
    r = rays(w, h)
    t = (y - EYE[1]) / r[..., 1]
    t[t <= 0] = np.inf
    return t, EYE[None, None] + r * t[..., None]
