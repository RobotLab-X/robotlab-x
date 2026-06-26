# Models - Shared Pydantic Models

> **Parent**: [packages](../README.md) · **Repo root**: [Repo Root](../../README.md)

This is the `models` Python library.

The `models` package provides shared data models and type definitions used across multiple CloudSeeder applications and packages. It defines core Pydantic models, enums, and schemas that represent entities, API payloads, and other structured data shared between services.

## Purpose

- Centralize common data models for consistency across apps
- Enable type-safe API contracts and validation
- Reduce duplication of model definitions

## Typical Contents

- Pydantic model classes for shared entities
- Enums and constants for cross-app use
- Serialization/deserialization helpers

## Usage

Import models from this package in any app or package that needs to share data structures:

```python
from models import SomeSharedModel
```

Update this README if new major model categories or usage patterns are added.
