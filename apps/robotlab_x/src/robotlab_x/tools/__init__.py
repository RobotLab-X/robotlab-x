# unmanaged
"""robotlab_x ops tools — read-only diagnostics + occasional cleanup helpers.

These run as standalone scripts (``python -m robotlab_x.tools.<name>``)
against a non-running backend (TinyDB locks the files only briefly) and
report on disk + process state. Never write a service_proxy or workspace
row from here — that's lifecycle's job.
"""
