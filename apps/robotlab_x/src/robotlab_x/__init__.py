"""robotlab_x package.

Loads ``.env`` + bridges ``ROBOTLAB_X_JWT_SECRET → JWT_SECRET_KEY``
BEFORE any submodule import touches ``packages/auth``.

Why this lives here rather than in ``main.py``:

``packages/auth/jwt_util.py`` captures ``JWT_SECRET_KEY`` into a
module-level constant at IMPORT time. ``main.py`` imports
``robotlab_x.server`` at the top, and ``server.py`` pulls in the auth
chain. By the time ``main.py``'s body runs ``load_dotenv()`` and the
event_handlers bridge fires, the auth module has already locked
``JWT_SECRET_KEY = "fallback_dev_key"`` and the .env value is dead.

Doing the load + bridge HERE makes them run during the package
import, which happens BEFORE any submodule import — so jwt_util
sees the correct value when it captures.

Safe + idempotent: this code runs on every Python import of
``robotlab_x``, including under pytest. ``load_dotenv`` silently
no-ops if the file is missing; the bridge no-ops if its inputs
aren't set.
"""
from __future__ import annotations

import os as _os


def _cli_env_file() -> "str | None":
    """Peek at sys.argv for ``--env_file PATH`` / ``--env-file PATH``
    so the early bootstrap can honour the same flag main.py will
    parse. Returns None when no override is given.

    We only look for the flag — we don't validate or consume; main.py
    re-parses argv normally."""
    import sys as _sys
    argv = _sys.argv[1:]
    for i, arg in enumerate(argv):
        if arg in ("--env_file", "--env-file") and i + 1 < len(argv):
            return argv[i + 1]
        for prefix in ("--env_file=", "--env-file="):
            if arg.startswith(prefix):
                return arg[len(prefix):]
    return None


def _early_env_bootstrap() -> None:
    """Load .env from cwd (and the CLI-supplied --env_file if any) +
    bridge ROBOTLAB_X_JWT_SECRET to JWT_SECRET_KEY so packages/auth
    sees the real value at its import-time capture.

    Order:
      1. Default ``.env`` in cwd (load_dotenv default — never override)
      2. CLI ``--env_file PATH`` with override=True (CLI > default)
      3. Bridge ROBOTLAB_X_JWT_SECRET → JWT_SECRET_KEY

    ``JWT_SECRET_KEY`` set in the shell env stays untouched (the
    bridge only fills it when missing)."""
    try:
        from dotenv import load_dotenv
        load_dotenv()
        cli_env = _cli_env_file()
        if cli_env:
            # override=True so the CLI file's values supersede whatever
            # the default .env already put in env. This is what the user
            # expects from ``--env_file .env.funny-droid``.
            load_dotenv(cli_env, override=True)
    except Exception:
        pass

    if not _os.environ.get("JWT_SECRET_KEY"):
        bridge = _os.environ.get("ROBOTLAB_X_JWT_SECRET")
        if bridge:
            _os.environ["JWT_SECRET_KEY"] = bridge


_early_env_bootstrap()
