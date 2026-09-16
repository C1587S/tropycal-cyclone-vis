#!/usr/bin/env bash
# Publish one GeoClaw run to the viewer: assemble it from the report
# directory into public/data, then upload the changed files to the Hugging
# Face dataset the deployed app reads from. The run's registry entry is part
# of the upload, so it appears in the viewer without any commit or deploy.
#
# Usage:
#   ./scripts/publish.sh <run_name> [report_dir] [anim_dir]
#
# Requirements (one-time, see README):
#   - python env with numpy, pandas, xarray, netCDF4, zarr
#   - pip install -U huggingface_hub
#   - a write token for the dataset: hf auth login  (or export HF_TOKEN=...)
#   - HF_DATASET set to the dataset repo id, e.g. export HF_DATASET=org/name
set -euo pipefail

RUN=${1:?usage: publish.sh <run_name> [report_dir] [anim_dir]}
REPO_DIR=$(cd "$(dirname "$0")/.." && pwd)

if [ -n "${CIL_ROOT:-}" ]; then CIL=$CIL_ROOT
elif [ -d /project/cil ]; then CIL=/project/cil
elif [ -d /Volumes/cil ]; then CIL=/Volumes/cil
else echo "cluster filesystem not found; set CIL_ROOT" >&2; exit 1; fi

REPORT_DIR=${2:-$CIL/home_dirs/dtadeo/coastal-core/reports/$RUN}
ANIM_DIR=${3:-$CIL/home_dirs/dtadeo/coastal-core/reports/anim}
DATASET=${HF_DATASET:?set HF_DATASET to the dataset repo id, e.g. org/tropical-cyclone-runs}

[ -f "$REPORT_DIR/manifest.json" ] || { echo "no manifest.json in $REPORT_DIR" >&2; exit 1; }

# hf is the current CLI entry point; huggingface-cli the legacy one
if command -v hf >/dev/null 2>&1; then HF=hf
elif command -v huggingface-cli >/dev/null 2>&1; then HF=huggingface-cli
else echo "huggingface CLI not found: pip install -U huggingface_hub" >&2; exit 1; fi

echo "== assemble $RUN from $REPORT_DIR"
python3 "$REPO_DIR/scripts/assemble.py" \
  --run "$RUN" \
  --report-dir "$REPORT_DIR" \
  --anim-dir "$ANIM_DIR" \
  --steps manifest,details,anim,params,tracks,ganim

# Upload the whole staging tree; the CLI hashes files and only transfers
# what changed, which also refreshes projects.json and the registry.
echo "== upload to $DATASET"
$HF upload "$DATASET" "$REPO_DIR/public/data" . \
  --repo-type dataset \
  --commit-message "publish $RUN"

echo "== published; the viewer picks it up on next load"
