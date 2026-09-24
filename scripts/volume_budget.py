"""Volume budget of a GeoClaw run from its raw fort.q archive.

Answers two questions about an unstable storm: is the volume change gradual
or a single event (total volume per frame), and where on the domain does it
happen (per-frame volume differences aggregated onto the 0.25 deg base
grid, plus a band budget against the open north/south boundaries).

AMR overlap is removed exactly: Berger-Colella nesting aligns every level
l+1 patch to level-l cells, so covered regions are masked by index range,
level by level. Cell weights are dx*dy*cos(lat), matching GeoClaw's
capacity function up to a constant, which cancels in fractional changes.

Usage:
    python3 scripts/volume_budget.py <run_dir_with_fort.q> [--out out.json.gz]
"""

from __future__ import annotations

import argparse
import gzip
import json
import sys
from pathlib import Path

import numpy as np

BASE_DX = 0.25  # level-1 resolution; every patch aligns to this grid
BOUNDARY_BAND_DEG = 1.0  # attribution band along the open y-boundaries


def parse_frame(qpath: Path, meqn: int):
    """(level, xlow, ylow, dx, dy, h[my, mx]) per patch.

    output_format=3: fort.qNNNN holds only the patch headers; the data is a
    raw float64 stream in fort.bNNNN, per patch meqn*mx*my values with meqn
    the fastest index (clawpack's valout ordering).
    """
    tokens = qpath.read_text().split()
    headers = []
    i = 0
    while i < len(tokens):
        vals = []
        for _ in range(8):
            vals.append(tokens[i])
            i += 2  # skip the label token
        headers.append(vals)
    data = np.fromfile(str(qpath).replace("fort.q", "fort.b"), dtype=np.float64)
    # binary output includes ghost cells; infer the ghost width that makes
    # the patch sizes sum to the stream length
    ghost = None
    for g in range(4):
        n = sum(meqn * (int(v[2]) + 2 * g) * (int(v[3]) + 2 * g) for v in headers)
        if n == data.size:
            ghost = g
            break
    if ghost is None:
        raise ValueError(f"{qpath.name}: no ghost width fits {data.size} doubles")
    patches = []
    off = 0
    for vals in headers:
        level, mx, my = int(vals[1]), int(vals[2]), int(vals[3])
        xlow, ylow, dx, dy = (float(v.replace("D", "E")) for v in vals[4:8])
        gx, gy = mx + 2 * ghost, my + 2 * ghost
        n = meqn * gx * gy
        h = data[off : off + n].reshape(gy, gx, meqn)[:, :, 0]
        if ghost:
            h = h[ghost:-ghost, ghost:-ghost]
        off += n
        patches.append((level, xlow, ylow, dx, dy, h))
    return patches


def frame_volume(patches):
    """Total volume (deg^2*m, cos-lat weighted) and its 0.25-deg grid."""
    # global base grid, wide enough for any domain
    nx, ny = int(round(360 / BASE_DX)), int(round(180 / BASE_DX))
    grid = np.zeros((ny, nx))
    by_level: dict[int, list] = {}
    for p in patches:
        by_level.setdefault(p[0], []).append(p)
    total = 0.0
    for level in sorted(by_level):
        finer = by_level.get(level + 1, [])
        for _, xlow, ylow, dx, dy, h in by_level[level]:
            my, mx = h.shape
            mask = np.ones_like(h, dtype=bool)
            for _, fx, fy, fdx, fdy, fh in finer:
                fmy, fmx = fh.shape
                # finer patch extent in this patch's index space (aligned)
                i0 = int(round((fx - xlow) / dx))
                i1 = int(round((fx + fmx * fdx - xlow) / dx))
                j0 = int(round((fy - ylow) / dy))
                j1 = int(round((fy + fmy * fdy - ylow) / dy))
                if i1 <= 0 or j1 <= 0 or i0 >= mx or j0 >= my:
                    continue
                mask[max(0, j0) : min(my, j1), max(0, i0) : min(mx, i1)] = False
            lats = ylow + (np.arange(my) + 0.5) * dy
            w = dx * dy * np.cos(np.radians(lats))[:, None]
            hw = np.where(mask, h, 0.0) * w
            total += float(hw.sum())
            # aggregate onto the base grid by cell-centre index: works for
            # any patch size or alignment, fine or coarse
            xc = xlow + (np.arange(mx) + 0.5) * dx
            yc = lats
            ix = np.clip(((xc + 180) / BASE_DX).astype(int), 0, grid.shape[1] - 1)
            iy = np.clip(((yc + 90) / BASE_DX).astype(int), 0, grid.shape[0] - 1)
            np.add.at(grid, (iy[:, None], ix[None, :]), hw)
    return total, grid


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("run_dir", help="directory holding _output/fort.q*")
    ap.add_argument("--out", help="write the budget as json.gz here")
    ap.add_argument("--cell-floor", type=float, default=1e-9,
                    help="keep per-frame delta cells above this fraction of V0")
    ap.add_argument("--map-floor", type=float, default=2e-10,
                    help="keep cumulative 1-deg map cells above this fraction of V0")
    args = ap.parse_args()
    out_dir = Path(args.run_dir) / "_output"
    qfiles = sorted(out_dir.glob("fort.q[0-9]*"))
    if not qfiles:
        sys.exit(f"no fort.q files under {out_dir}")

    times, totals = [], []
    prev_grid = None
    deltas = []  # per-frame sparse [ix, iy, dV]
    band_series = []  # per-frame [north, south, interior] dV
    cum = None
    v0 = None
    for q in qfiles:
        t_tokens = (out_dir / q.name.replace("fort.q", "fort.t")).read_text().split()
        t, meqn = float(t_tokens[0].replace("D", "E")), int(t_tokens[2])
        total, grid = frame_volume(parse_frame(q, meqn))
        if v0 is None:
            v0 = total
            cum = np.zeros_like(grid)
        times.append(t)
        totals.append(total)
        if prev_grid is not None:
            d = grid - prev_grid
            cum += d
            keep = np.abs(d) > args.cell_floor * v0
            ys, xs = np.nonzero(keep)
            deltas.append([[int(x), int(y), float(d[y, x])] for y, x in zip(ys, xs)])
            nyb = int((90 + 60 - BOUNDARY_BAND_DEG) / BASE_DX)
            syb = int((90 - 60 + BOUNDARY_BAND_DEG) / BASE_DX)
            dn = float(d[nyb:, :].sum())
            dso = float(d[:syb, :].sum())
            band_series.append([dn, dso, float(d.sum()) - dn - dso])
        else:
            deltas.append([])
            band_series.append([0.0, 0.0, 0.0])
        prev_grid = grid
        print(f"{q.name}: t={t / 3600:9.1f} h  V/V0-1 = {(total - v0) / v0:+.3e}", flush=True)

    frac = [(v - v0) / v0 for v in totals]
    # band budget along the open y-boundaries: where did the change happen?
    ys, xs = np.nonzero(np.abs(cum) > 0)
    lat = (ys + 0.5) * BASE_DX - 90
    north = float(cum[ys[lat >= 60 - BOUNDARY_BAND_DEG], xs[lat >= 60 - BOUNDARY_BAND_DEG]].sum()) if len(ys) else 0.0
    south = float(cum[ys[lat <= -60 + BOUNDARY_BAND_DEG], xs[lat <= -60 + BOUNDARY_BAND_DEG]].sum()) if len(ys) else 0.0
    interior = float(cum.sum()) - north - south

    print("\n=== budget ===")
    print(f"V0 (weighted)            : {v0:.6e}")
    print(f"final fractional change  : {frac[-1]:+.3e}")
    print(f"max |fractional change|  : {max(abs(f) for f in frac):.3e}")
    print(f"cumulative dV north band : {north / v0:+.3e} (lat >= {60 - BOUNDARY_BAND_DEG})")
    print(f"cumulative dV south band : {south / v0:+.3e} (lat <= {-60 + BOUNDARY_BAND_DEG})")
    print(f"cumulative dV interior   : {interior / v0:+.3e}")

    if args.out:
        # the cumulative field is diffuse (a few 1e-10 per base cell spread
        # over the wetted domain), so the shipped map aggregates to 1 deg
        # with a floor low enough to keep the storm-path hotspots
        r = int(round(1.0 / BASE_DX))
        ny, nx = cum.shape
        cum1 = cum[: ny - ny % r, : nx - nx % r].reshape(ny // r, r, nx // r, r).sum(axis=(1, 3))
        cys, cxs = np.nonzero(np.abs(cum1) > args.map_floor * v0)
        payload = {
            "source": str(Path(args.run_dir).resolve()),
            "base_dx": 1.0,
            "times_s": times,
            "frac_change": frac,
            "v0": v0,
            "band": {"north": north / v0, "south": south / v0, "interior": interior / v0},
            "band_series": [[b[0] / v0, b[1] / v0, b[2] / v0] for b in band_series],
            "cum_cells": [[int(x), int(y), float(cum1[y, x])] for y, x in zip(cys, cxs)],
        }
        raw = json.dumps(payload, separators=(",", ":")).encode()
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_bytes(gzip.compress(raw, 9))
        print(f"wrote {args.out} ({len(gzip.compress(raw, 9)) / 1e3:.0f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
