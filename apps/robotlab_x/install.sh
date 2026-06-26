#!/usr/bin/env bash
# managed
set -e

if ! command -v python3.12 >/dev/null 2>&1; then
  echo "python3.12 is required to create this venv. Install Python 3.12 and re-run." >&2
  exit 1
fi

if [ ! -d ".venv" ]; then
  uv venv --python python3.12
fi

source .venv/bin/activate
# --all-extras installs every optional extras group declared in
# pyproject.toml (dev tools + per-pipeline deps like `llm`,
# `docai_invoice_parser`). Production images can opt into a subset via
# `uv sync --extra llm` etc. Re-running install.sh after a pyproject.toml
# change reconciles the venv to the new deps.
uv sync --all-extras
uv pip install -e .
