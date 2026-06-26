@echo off
REM managed
setlocal

if not exist ".venv" (
    uv venv --python 3.12
)

call .venv\Scripts\activate.bat
uv sync --extra dev
uv pip install -e .
