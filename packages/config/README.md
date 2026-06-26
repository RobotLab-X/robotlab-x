# Config - Configuration Package

> **Parent**: [packages](../README.md) · **Repo root**: [Repo Root](../../README.md)

Environment-variable-driven configuration package for FastAPI apps. Provides `create_app_settings()`, which constructs a per-app Pydantic settings object from environment variables, and a `ConfigProvider` callable that downstream code uses to read configuration at runtime.

See the **`config/`** section in [`../README.md`](../README.md) for the canonical reference — usage examples, the `Config` model contract, and how each app wires it up.

## Quick start

```python
from config import create_app_settings
from myapp.models.config import Config

settings, config_provider = create_app_settings("myapp", Config)
```

`settings` is the Pydantic settings object; `config_provider` is a zero-arg callable returning the same data as a dict for components that prefer dict access.

## Dependencies

None — `config` is a leaf package. Other packages (`auth`, `database`) depend on it.

## Related

- [packages/README.md](../README.md) — full package descriptions and the `config/` section as canonical reference
- [packages/auth/README.md](../auth/README.md) — consumes `config` to read Okta / API-key settings
- [packages/database/README.md](../database/README.md) — consumes `config` to read database connection info
