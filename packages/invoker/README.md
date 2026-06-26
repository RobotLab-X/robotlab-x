# Invoker — Dynamic Dispatch Package

> **Parent**: [packages](../README.md) · **Repo root**: [Repo Root](../../README.md)

Tiny utility package for **dynamic module/function dispatch** — load a Python module by name at runtime and call a function on it, with an existence-check guard so callers can probe before invoking.

Used by `hyrule_api` to wire pipeline steps and CRUD route factories without static imports, so new services can be added without re-editing the dispatcher.

## API

Three functions, all in `invoker.invoker`:

### `invoker(module_name, function_name, parameters=None)`

Import the module by name and call the function with the given positional parameters. Raises `ModuleNotFoundError` or `AttributeError` if either is missing.

```python
from invoker.invoker import invoker

result = invoker("myapp.pipeline", "run", parameters=[payload])
```

### `module_function_exists(module_name, function_name)`

Returns `True` if the module imports cleanly *and* contains the named function. Uses `importlib.util.find_spec` to avoid importing the module just to check.

```python
from invoker.invoker import module_function_exists

if module_function_exists("myapp.pipeline", "run"):
    ...
```

### `safe_invoke(module_name, function_name, parameters=None)`

Combines the two: checks existence, calls if present, returns `None` otherwise (with a stdout warning). Use when you'd rather degrade gracefully than handle exceptions.

```python
from invoker.invoker import safe_invoke

result = safe_invoke("myapp.pipeline", "run", parameters=[payload])
if result is None:
    # function or module wasn't found; carry on
    ...
```

## Where it's used

- [`apps/hyrule_api/src/hyrule_api/server.py`](../../apps/hyrule_api/src/hyrule_api/server.py) — invokes startup hooks discovered by name
- [`apps/hyrule_api/src/hyrule_api/api/crud_router_factory.py`](../../apps/hyrule_api/src/hyrule_api/api/crud_router_factory.py) — dispatches per-resource handlers without compile-time imports

## Why not just `getattr(__import__(...))`?

You can. `invoker` exists to:
1. Keep the existence-check path (`safe_invoke`) in one place
2. Use `importlib.util.find_spec` for the existence check, which is faster than catching `ImportError` and doesn't execute module-level side effects
3. Give callers a consistent signature regardless of how the underlying function takes its arguments (params is always a list)

## Install / dev

This is a workspace package — it's installed automatically by the root-level `run_package_tests.sh` and by each app's `install.sh` via `pip install -e ../../packages/invoker`.

For standalone work:

```bash
cd packages/invoker
pip install -e .
pytest
```

## Layout

```text
packages/invoker/
├── pyproject.toml
├── setup.py
└── src/invoker/
    ├── __init__.py
    └── invoker.py    # the 3 functions above
```

The `__init__.py` re-exports the three functions so `from invoker import safe_invoke` works in addition to `from invoker.invoker import safe_invoke`.

## Related

- [`packages/README.md`](../README.md) — index of all shared packages
