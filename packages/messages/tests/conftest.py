# Ensure the package's src/ directory is on sys.path so tests can import `messages` without installing the package.
import os
import sys
import importlib
import pytest

TESTS_DIR = os.path.dirname(__file__)
# tests are located at packages/messages/tests, src is at packages/messages/src
SRC_DIR = os.path.abspath(os.path.join(TESTS_DIR, "..", "src"))
if SRC_DIR not in sys.path:
    sys.path.insert(0, SRC_DIR)


@pytest.fixture(autouse=True)
def clear_message_clients():
    """Clear the messages factory singleton registry before each test."""
    try:
        factory = importlib.import_module("messages.factory")
        if hasattr(factory, "_clients"):
            factory._clients.clear()
    except Exception:
        # ignore import errors; tests will fail later if module missing
        pass
    yield
    try:
        if 'factory' in locals():
            factory._clients.clear()
    except Exception:
        pass
