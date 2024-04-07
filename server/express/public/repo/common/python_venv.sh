#!/bin/sh
python3 -m venv "{{directory}}/{{venvName}}"
source "{{directory}}/{{venvName}}/bin/activate"
pip install {{packageName}}
python3 "{{directory}}/{{pythonScript}}"
# Removed deactivate
