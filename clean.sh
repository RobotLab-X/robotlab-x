#!/bin/bash

# rm -rf dist
# rm -rf node_modules
# rm client/yarn.lock
# rm -rf client/node_modules
# rm server/yarn.lock
# rm -rf server/node_modules
# rm -rf server/dist

# rm -rf server/express/public/repo/pyaudio/.venv
# rm -rf server/express/public/repo/pyaudio/rlx_pkg_pyaudio/rlx_pkg_pyaudio.egg-info
# rm -rf server/express/public/repo/proxy/rlx_pkg_proxy/rlx_pkg_proxy.egg-info
# rm -rf server/express/public/repo/pyaudio/rlx_pkg_pyaudio/rlx_pkg_pyaudio.egg-info


# Remove all .egg files
find . -type f -name "*.egg" -exec rm -f {} +

# Remove all __pycache__ directories
find . -type d -name "__pycache__" -exec rm -rf {} +
find . -type d -name ".venv" -exec rm -rf {} +
find . -type d -name "*.egg-info" -exec rm -rf {} +

echo "All *.egg files and __pycache__ .venv directories have been removed."
