# unmanaged
"""Config-set loader — stone 2 of the TODO_CONFIG_SETS spec.

Resolves the active config set, parses ``runtime.yml`` + each
``<proxy_id>.yml``, walks the parsed tree to decrypt ``Encrypted--``
leaves via the provided callable, validates each result against the
type's ``config_class``, then yields ready-to-spawn ``LoadedEntry``
tuples in declared start order.

Capability check is inline: as proxies are yielded, their type's
``requires:`` list must already be satisfied by previously-yielded
types' ``implements:`` list. Failures raise ``CapabilityUnsatisfied``
with a clear message pointing at the proxy + the missing capability.

This module is the contract between filesystem state and the spawn
machinery. It does NOT call any lifecycle code itself — stone 4 will
wire ``load_config_set()`` into the boot path.

Layout (the active set's directory)::

    runtime.yml              # start_order: [proxy_id, ...]
    <proxy_id>.yml           # type: name@version + config fields
    <candidate>.yml          # any yml not listed in start_order

Errors raised here all inherit from ``ConfigSetError`` so callers
(stone 4) can catch broadly and translate to lifecycle status=error.
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, Iterator, List, Optional

import yaml
from pydantic import BaseModel, SecretStr

from robotlab_x.runtime.repo import PackageManifest


logger = logging.getLogger(__name__)


# Wire-format markers — mirror the security service. Kept here so the
# loader doesn't depend on the security module at import time (security
# may not be on sys.path during a partial bring-up, e.g. tests).
ENCRYPT_PREFIX = "Encrypt--"
ENCRYPTED_PREFIX = "Encrypted--"

# Default config-set name when no env var is set.
DEFAULT_SET_NAME = "default"
# Env var that overrides which set boots.
SET_ENV_VAR = "ROBOTLAB_X_CONFIG_SET"


# ─── errors ───────────────────────────────────────────────────────────


class ConfigSetError(Exception):
    """Base for all loader failures. Catch this in lifecycle code."""


class ConfigSetMissing(ConfigSetError):
    """The active set directory doesn't exist on disk."""


class RuntimeYmlInvalid(ConfigSetError):
    """``runtime.yml`` failed to parse or has the wrong shape."""


class ProxyYmlMissing(ConfigSetError):
    """A proxy_id listed in ``start_order`` has no matching yml file."""


class ProxyYmlInvalid(ConfigSetError):
    """A proxy yml file is malformed, missing ``type:``, or fails
    Pydantic validation."""


class TypeNotInRegistry(ConfigSetError):
    """A proxy yml's ``type:`` field points at a type not in the
    registry. Either a typo or a missing package."""


class CapabilityUnsatisfied(ConfigSetError):
    """A proxy's ``requires:`` capability has no implementer in the
    set's start_order (yet) at the point it's being yielded."""


class DecryptError(ConfigSetError):
    """A leaf string starting with ``Encrypted--`` couldn't be decrypted
    (wrong key, tampering, or no security service available)."""


# ─── data classes ─────────────────────────────────────────────────────


@dataclass
class RuntimeYml:
    """Parsed ``runtime.yml``. Today: just start_order; the file can
    grow new fields without breaking existing callers."""
    start_order: List[str] = field(default_factory=list)


@dataclass
class LoadedEntry:
    """One validated, decrypted, capability-checked proxy ready to
    spawn. ``config`` is a live Pydantic instance of the type's
    ``config_class`` — pass it straight to the in-process adapter."""
    proxy_id: str
    type_id: str                       # e.g. "brain@1.0.0"
    manifest: PackageManifest
    config: Any                        # an instance of manifest's Service.config_class


@dataclass
class CandidateInfo:
    """A yml file present in the set but NOT in start_order. Shown in
    the UI as a swap target."""
    proxy_id: str                      # filename minus .yml
    type_id: Optional[str]             # None if the file lacks a type: field
    file_path: Path
    parse_error: Optional[str] = None  # set if yml didn't parse


# ─── active set resolution ────────────────────────────────────────────


# The active set is PINNED at boot: the LIVE process reads/writes only the
# set it actually booted with, so a UI "switch" (which rewrites the marker
# for the NEXT boot) can't silently retarget live config-set I/O and corrupt
# another set. The env/marker is consulted only to (a) decide what to boot,
# and (b) report the pending next-boot set to the UI.
_BOOTED_SET: Optional[str] = None


def _resolve_active_set_name() -> str:
    """Resolve a set name from env var → marker file → 'default'. This is the
    NEXT-boot choice; runtime code must use active_set_name() instead."""
    env = os.environ.get(SET_ENV_VAR, "").strip()
    if env:
        return env
    try:
        from config import get_settings
        settings = get_settings()
        data_dir = Path(getattr(settings, "data_dir", None) or "data")
        if not data_dir.is_absolute():
            data_dir = Path.cwd() / data_dir
        marker = data_dir / "config_sets" / "active_set.txt"
        if marker.is_file():
            chosen = marker.read_text().strip()
            if chosen:
                return chosen
    except Exception:  # noqa: BLE001
        pass
    return DEFAULT_SET_NAME


def pin_booted_set(name: Optional[str] = None) -> str:
    """Pin the active set for the life of THIS process (call once at boot,
    after the env/marker is known). Runtime reads/writes resolve against
    this. Returns the pinned name."""
    global _BOOTED_SET
    _BOOTED_SET = name or _resolve_active_set_name()
    logger.info("config_sets: pinned booted set = %s", _BOOTED_SET)
    return _BOOTED_SET


def active_set_name() -> str:
    """The set the LIVE process is running (pinned at boot). All runtime
    reads/writes (active_set_dir, per-proxy ymls) resolve against this — NOT
    the marker, which only chooses the next boot. Falls back to resolving the
    env/marker before the pin is set (i.e. during boot itself)."""
    return _BOOTED_SET if _BOOTED_SET is not None else _resolve_active_set_name()


def pending_set_name() -> str:
    """The set selected for the NEXT boot (env var / marker file). Equals
    active_set_name() unless a switch is staged and awaiting a restart."""
    return _resolve_active_set_name()


def active_set_dir(data_dir: Path) -> Path:
    """Resolve the active set directory under ``<data_dir>/config_sets/``.
    Does NOT verify existence — callers handle missing-set themselves
    so they can pick between "create + seed" and "fail loud"."""
    return (data_dir / "config_sets" / active_set_name()).resolve()


# ─── encryption walk ──────────────────────────────────────────────────


def _walk_decrypt(node: Any, decrypt_fn: Callable[[str], str]) -> Any:
    """Recursively walk a parsed yml tree and rewrite every string leaf
    starting with ``Encrypted--`` via ``decrypt_fn``.

    Returns a NEW structure rather than mutating the input — keeps the
    on-disk dict separately usable for diff/inspection if a caller
    holds onto it.
    """
    if isinstance(node, dict):
        return {k: _walk_decrypt(v, decrypt_fn) for k, v in node.items()}
    if isinstance(node, list):
        return [_walk_decrypt(v, decrypt_fn) for v in node]
    if isinstance(node, str) and node.startswith(ENCRYPTED_PREFIX):
        try:
            return decrypt_fn(node)
        except Exception as exc:  # noqa: BLE001
            raise DecryptError(
                f"failed to decrypt leaf {node[:40]!r}...: "
                f"{type(exc).__name__}: {exc}"
            ) from exc
    return node


def decrypt_tree(tree: Any, decrypt_fn: Optional[Callable[[str], str]]) -> Any:
    """Apply the decryption walk if ``decrypt_fn`` is non-None. When
    ``None`` (no security service available) the tree is returned
    unchanged — but any leaf still starting with ``Encrypted--`` will
    fail Pydantic validation downstream and surface as a clear error."""
    if decrypt_fn is None:
        return tree
    return _walk_decrypt(tree, decrypt_fn)


# ─── runtime.yml ──────────────────────────────────────────────────────


def load_runtime_yml(set_dir: Path) -> RuntimeYml:
    """Parse ``<set_dir>/runtime.yml``. Missing file → empty start_order
    (not an error — operator may be using a fresh set). Malformed file
    → ``RuntimeYmlInvalid`` with the parse failure."""
    path = set_dir / "runtime.yml"
    if not path.is_file():
        logger.info("config_sets: %s has no runtime.yml — empty start_order", set_dir)
        return RuntimeYml(start_order=[])
    try:
        raw = yaml.safe_load(path.read_text())
    except yaml.YAMLError as exc:
        raise RuntimeYmlInvalid(f"runtime.yml at {path} failed to parse: {exc}") from exc
    if raw is None:
        return RuntimeYml(start_order=[])
    if not isinstance(raw, dict):
        raise RuntimeYmlInvalid(
            f"runtime.yml at {path} must be a yaml mapping; got {type(raw).__name__}"
        )
    start_order = raw.get("start_order") or []
    if not isinstance(start_order, list) or not all(isinstance(x, str) for x in start_order):
        raise RuntimeYmlInvalid(
            f"runtime.yml::start_order must be a list of strings; got {start_order!r}"
        )
    return RuntimeYml(start_order=[s for s in start_order])


# ─── proxy yml ────────────────────────────────────────────────────────


def _read_yml(path: Path) -> Dict[str, Any]:
    try:
        raw = yaml.safe_load(path.read_text())
    except yaml.YAMLError as exc:
        raise ProxyYmlInvalid(f"{path} failed to parse: {exc}") from exc
    if raw is None:
        raise ProxyYmlInvalid(f"{path} is empty")
    if not isinstance(raw, dict):
        raise ProxyYmlInvalid(
            f"{path} must be a yaml mapping; got {type(raw).__name__}"
        )
    return raw


def _resolve_type_or_fail(type_id: str, manifests: Dict[str, PackageManifest]) -> PackageManifest:
    if type_id in manifests:
        return manifests[type_id]
    # If the operator wrote bare "brain" instead of "brain@1.0.0", try
    # to pick the unique manifest with that name. Friendly behavior;
    # ambiguity (>1 version) is still an error.
    matches = [m for m in manifests.values() if m.name == type_id]
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        versions = ", ".join(m.version for m in matches)
        raise TypeNotInRegistry(
            f"type {type_id!r} is ambiguous — multiple versions installed: {versions}. "
            f"Use {type_id}@<version> to pin one."
        )
    raise TypeNotInRegistry(
        f"type {type_id!r} not found in registry. "
        f"Available: {sorted(manifests.keys())}"
    )


def _instantiate_config_class(manifest: PackageManifest, data: Dict[str, Any], repo_dir: Path) -> Any:
    """Load the Service class for ``manifest``, then build an instance
    of its ``config_class`` from ``data``. Pydantic validation errors
    surface as ProxyYmlInvalid with the field path included."""
    # In-process loader — same machinery the spawn path uses, so we
    # exercise the exact resolution rules (single-file or package).
    from robotlab_x.framework.adapters.in_process import _load_service_class

    module_name = manifest.entry.module or manifest.name
    class_name = manifest.entry.class_name
    if not class_name:
        # Fall back to a Title-cased class name (e.g. clock → ClockService).
        # Matches the same convention the in-process adapter uses.
        class_name = "".join(p.capitalize() for p in manifest.name.split("_")) + "Service"
    try:
        cls = _load_service_class(
            repo_dir,
            manifest.name,
            manifest.version,
            module_name,
            class_name,
        )
    except Exception as exc:  # noqa: BLE001
        raise ProxyYmlInvalid(
            f"can't load Service class for type {manifest.id}: "
            f"{type(exc).__name__}: {exc}"
        ) from exc

    config_class = getattr(cls, "config_class", None)
    if config_class is None:
        raise ProxyYmlInvalid(
            f"Service {cls.__name__} has no config_class attribute — "
            f"every Service must declare one"
        )
    try:
        return config_class(**data)
    except Exception as exc:  # noqa: BLE001
        # Pydantic ValidationError stringifies into a readable
        # field-level report; we just wrap it.
        raise ProxyYmlInvalid(
            f"config validation failed for type {manifest.id}: "
            f"{type(exc).__name__}: {exc}"
        ) from exc


def load_proxy_yml(
    set_dir: Path,
    proxy_id: str,
    manifests: Dict[str, PackageManifest],
    repo_dir: Path,
    decrypt_fn: Optional[Callable[[str], str]] = None,
) -> LoadedEntry:
    """Read ``<set_dir>/<proxy_id>.yml``, decrypt, resolve type, validate.

    Returns a ``LoadedEntry`` with a live ``config_class`` instance.
    Raises one of the ``ConfigSetError`` subclasses on any failure.
    """
    path = set_dir / f"{proxy_id}.yml"
    if not path.is_file():
        raise ProxyYmlMissing(
            f"no yml for proxy_id={proxy_id!r} in {set_dir} "
            f"(expected {path})"
        )
    raw = _read_yml(path)
    type_id = raw.pop("type", None)
    # desired_state is runtime/lifecycle metadata, not service config — strip
    # it before validating against config_class so it never lands in the
    # service's config tree (and never round-trips back into it on save).
    raw.pop("desired_state", None)
    if not type_id or not isinstance(type_id, str):
        raise ProxyYmlInvalid(
            f"{path} is missing a top-level ``type:`` field (e.g. "
            f"``type: brain@1.0.0``). Every proxy yml MUST declare its type."
        )

    # Resolve the type's manifest. This may "promote" a bare name to a
    # specific version if exactly one is installed.
    manifest = _resolve_type_or_fail(type_id, manifests)

    # Decrypt any Encrypted-- leaves before Pydantic sees them. If
    # decrypt_fn is None and there are any Encrypted-- leaves left,
    # the SecretStr field will fail validation — clear error.
    decrypted = decrypt_tree(raw, decrypt_fn)

    config = _instantiate_config_class(manifest, decrypted, repo_dir)
    return LoadedEntry(
        proxy_id=proxy_id,
        type_id=manifest.id,
        manifest=manifest,
        config=config,
    )


# ─── capability check ─────────────────────────────────────────────────


def check_capability(entry: LoadedEntry, provided: set) -> None:
    """Verify ``entry``'s required capabilities are satisfied by the
    accumulated ``provided`` set. Raises ``CapabilityUnsatisfied``
    with a clear pointer at the proxy + missing capability."""
    for required in entry.manifest.requires:
        if required not in provided:
            raise CapabilityUnsatisfied(
                f"proxy {entry.proxy_id!r} (type {entry.type_id}) requires "
                f"capability {required!r}, but no earlier proxy in "
                f"start_order implements it. "
                f"Available so far: {sorted(provided)}"
            )


# ─── candidates ───────────────────────────────────────────────────────


def discover_candidates(set_dir: Path, start_order: List[str]) -> List[CandidateInfo]:
    """List ``*.yml`` files in ``set_dir`` whose filename (without
    extension) is not in ``start_order``, excluding ``runtime.yml``.

    A candidate is a parked alternative implementation — operators
    swap one in by renaming. The UI surfaces these so the swap is one
    click + a restart.

    Files that fail to parse or lack ``type:`` are still surfaced
    (with ``parse_error`` set) so the UI can show why they're invalid
    rather than silently hiding them.
    """
    if not set_dir.is_dir():
        return []
    in_order = set(start_order)
    out: List[CandidateInfo] = []
    for path in sorted(set_dir.iterdir()):
        if not path.is_file() or path.suffix != ".yml":
            continue
        if path.name == "runtime.yml":
            continue
        proxy_id = path.stem
        if proxy_id in in_order:
            continue
        # Try to parse; surface a candidate either way.
        try:
            raw = yaml.safe_load(path.read_text())
        except yaml.YAMLError as exc:
            out.append(CandidateInfo(
                proxy_id=proxy_id, type_id=None, file_path=path,
                parse_error=str(exc),
            ))
            continue
        if not isinstance(raw, dict):
            out.append(CandidateInfo(
                proxy_id=proxy_id, type_id=None, file_path=path,
                parse_error=f"not a yaml mapping (got {type(raw).__name__})",
            ))
            continue
        type_id = raw.get("type")
        out.append(CandidateInfo(
            proxy_id=proxy_id,
            type_id=type_id if isinstance(type_id, str) else None,
            file_path=path,
            parse_error=None if isinstance(type_id, str) else "no type: field",
        ))
    return out


# ─── top-level orchestrator ───────────────────────────────────────────


def load_config_set(
    set_dir: Path,
    manifests: Dict[str, PackageManifest],
    repo_dir: Path,
    decrypt_fn: Optional[Callable[[str], str]] = None,
    *,
    extra_start_order: Optional[List[str]] = None,
) -> Iterator[LoadedEntry]:
    """Walk the config set in declared start order; yield each
    validated, decrypted, capability-checked ``LoadedEntry`` in turn.

    Stops at the first failure — yielded entries up to that point are
    safe to spawn. The caller decides whether to abort the whole boot
    or to continue with partial state.

    ``extra_start_order`` (typically ``["runtime", "security"]``)
    prepends entries to whatever ``runtime.yml`` declares. Stone 4
    will populate this; tests can leave it empty or pass an explicit
    list.
    """
    if not set_dir.is_dir():
        raise ConfigSetMissing(
            f"config set directory does not exist: {set_dir}. "
            f"Set ${SET_ENV_VAR} or create {set_dir.name}/."
        )
    runtime_yml = load_runtime_yml(set_dir)
    start_order: List[str] = []
    if extra_start_order:
        start_order.extend(extra_start_order)
    # Don't double-add singletons if the user also listed them.
    for proxy_id in runtime_yml.start_order:
        if proxy_id not in start_order:
            start_order.append(proxy_id)

    provided: set = set()
    for proxy_id in start_order:
        entry = load_proxy_yml(
            set_dir, proxy_id, manifests, repo_dir, decrypt_fn=decrypt_fn,
        )
        check_capability(entry, provided)
        # After yielding, this entry's implements[] become available
        # for subsequent proxies. We add them BEFORE yielding because
        # the consumer might block — by then this proxy is started.
        provided.update(entry.manifest.implements)
        yield entry


# ─── save path (counterpart to load) ──────────────────────────────────


def _unwrap_for_serialization(value: Any) -> Any:
    """Recursively convert a Pydantic config tree into a yaml-safe dict.

    SecretStr values are rewritten as ``Encrypt--<plaintext>`` markers
    so the encrypt-walk that follows can treat every secret uniformly,
    whether it came from a typed SecretStr field or an operator-typed
    ``Encrypt--`` seed in the yml.
    """
    if isinstance(value, SecretStr):
        plain = value.get_secret_value()
        return f"{ENCRYPT_PREFIX}{plain}" if plain else None
    if isinstance(value, BaseModel):
        # Nested config model (e.g. a motor_control MotorChannel, an
        # ik_solver Joint). Walk its declared fields + extras and recurse
        # so the result is a plain yaml-safe dict AND any SecretStr nested
        # inside still becomes an Encrypt-- marker. Without this branch a
        # live model instance reaches yaml.safe_dump and raises
        # RepresenterError, silently aborting the whole save.
        out: Dict[str, Any] = {}
        for name in type(value).model_fields:
            out[name] = _unwrap_for_serialization(getattr(value, name))
        extras = getattr(value, "__pydantic_extra__", None) or {}
        for name, v in extras.items():
            if name not in out:
                out[name] = _unwrap_for_serialization(v)
        return out
    if isinstance(value, dict):
        return {k: _unwrap_for_serialization(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_unwrap_for_serialization(v) for v in value]
    if isinstance(value, tuple):
        return [_unwrap_for_serialization(v) for v in value]
    return value


def _config_to_dict(config_instance: Any) -> Dict[str, Any]:
    """Dump a Pydantic config instance to a yaml-friendly dict that
    preserves SecretStr plaintext (so the encrypt-walk can handle it).

    Pydantic's default ``model_dump()`` masks SecretStr to
    ``'**********'`` which is exactly wrong for persistence — we need
    the value so security can encrypt it before writing to disk.

    Includes ``__pydantic_extra__`` so unknown fields (ServiceConfig
    is ``extra="allow"``) ride through round-trips intact.
    """
    out: Dict[str, Any] = {}
    for name in type(config_instance).model_fields:
        value = getattr(config_instance, name)
        out[name] = _unwrap_for_serialization(value)
    # Walk extras. Pydantic v2 stores them on __pydantic_extra__ when
    # the model_config sets extra="allow".
    extras = getattr(config_instance, "__pydantic_extra__", None) or {}
    for name, value in extras.items():
        if name in out:
            continue  # declared field takes precedence
        out[name] = _unwrap_for_serialization(value)
    return out


def _walk_encrypt(node: Any, encrypt_fn: Callable[[str], str]) -> Any:
    """Encrypt every string leaf carrying an ``Encrypt--`` or
    ``Encrypted--`` prefix. ``encrypt_fn`` must be idempotent on
    already-encrypted input (SecurityCore.encrypt is)."""
    if isinstance(node, dict):
        return {k: _walk_encrypt(v, encrypt_fn) for k, v in node.items()}
    if isinstance(node, list):
        return [_walk_encrypt(v, encrypt_fn) for v in node]
    if isinstance(node, str) and (
        node.startswith(ENCRYPT_PREFIX) or node.startswith(ENCRYPTED_PREFIX)
    ):
        return encrypt_fn(node)
    return node


def encrypt_tree(tree: Any, encrypt_fn: Optional[Callable[[str], str]]) -> Any:
    """Apply the encryption walk if ``encrypt_fn`` is non-None.

    When ``None`` and the tree contains any ``Encrypt--`` or unwrapped
    SecretStr marker, the caller (Service.save_config) should refuse to
    write — secrets must never reach disk in plaintext."""
    if encrypt_fn is None:
        return tree
    return _walk_encrypt(tree, encrypt_fn)


def _tree_has_unencrypted_secrets(tree: Any) -> bool:
    """Recursive check — is any leaf still tagged for encryption?
    Used by callers to refuse to persist plaintext secrets when no
    security service is available."""
    if isinstance(tree, dict):
        return any(_tree_has_unencrypted_secrets(v) for v in tree.values())
    if isinstance(tree, list):
        return any(_tree_has_unencrypted_secrets(v) for v in tree)
    if isinstance(tree, str) and tree.startswith(ENCRYPT_PREFIX):
        return True
    return False


def save_proxy_yml(
    set_dir: Path,
    proxy_id: str,
    type_id: str,
    config_instance: Any,
    encrypt_fn: Optional[Callable[[str], str]] = None,
    desired_state: Optional[str] = None,
) -> Path:
    """Serialize ``config_instance`` to ``<set_dir>/<proxy_id>.yml``.

    Atomic write via tmp + rename — a half-written file never appears
    at the final path. The ``type:`` field is always the first key in
    the output (yaml.safe_dump with sort_keys=False).

    ``desired_state`` (``'running'`` | ``'stopped'``), when given, is
    written as a top-level field right after ``type:``. It records the
    operator/runtime intent for the NEXT boot: ``running`` services are
    started by reconcile, ``stopped`` ones are instantiated (visible on
    the canvas) but left idle. ``None`` omits the field — boot then
    falls back to start_order membership (legacy behaviour).

    Secrets:
      * SecretStr field values are wrapped as ``Encrypt--<plaintext>``
        before encryption, so the encrypt walk handles them uniformly
        with operator-typed seeds.
      * If ``encrypt_fn`` is None AND the tree contains any
        ``Encrypt--`` marker (typed or via SecretStr), this raises
        ``DecryptError`` — refuse to write plaintext secrets to disk.

    Returns the absolute path of the written file.
    """
    data = _config_to_dict(config_instance)
    if encrypt_fn is None and _tree_has_unencrypted_secrets(data):
        raise DecryptError(
            f"refusing to write secrets in plaintext for {proxy_id}.yml "
            f"— security service is not available. Start the security "
            f"singleton first, or remove the secret fields."
        )
    data = encrypt_tree(data, encrypt_fn)
    payload = {"type": type_id}
    if desired_state is not None:
        payload["desired_state"] = desired_state
    payload.update(data)

    set_dir.mkdir(parents=True, exist_ok=True)
    path = set_dir / f"{proxy_id}.yml"
    tmp = path.with_suffix(".yml.tmp")
    tmp.write_text(yaml.safe_dump(payload, sort_keys=False, default_flow_style=False))
    tmp.rename(path)
    return path
