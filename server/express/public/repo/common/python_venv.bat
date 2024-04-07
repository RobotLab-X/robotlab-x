@echo off
python -m venv "{{directory}}\{{venvName}}"
"{{directory}}\{{venvName}}\Scripts\activate"
pip install {{packageName}}
python "{{directory}}\{{pythonScript}}"
# Removed deactivate
