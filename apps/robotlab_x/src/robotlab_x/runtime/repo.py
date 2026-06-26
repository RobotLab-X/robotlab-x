# unmanaged
"""Filesystem-driven service-type registry.

The repo dir under ``config.repo_dir`` is the source of truth for what
service types exist. Each type lives at::

    <repo>/<name>/<version>/
        package.yml
        icon.svg                # optional, palette + node icon
        pyproject.toml          # for pip services
        src/<name>/...          # the actual code
        .venv/                  # created on install (gitignored)

A scan walks ``*/*/package.yml`` and yields one ``PackageManifest`` per
service-version. Catalog seeding consumes this; the UI palette derives
icons from the served paths; the lifecycle uses ``install.kind`` to pick
between the pip subprocess installer and in-process builtins.

The scanner is deliberately forgiving — malformed yml is logged and
skipped, not raised, so one broken package doesn't blackhole the whole
boot. The catalog row for a broken package just disappears until the
file is fixed.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml


logger = logging.getLogger(__name__)


# Filenames the scanner looks for inside each <name>/<version>/ dir.
PACKAGE_MANIFEST_FILE = "package.yml"
ICON_FILENAME = "icon.svg"


# Permitted values for the small enum-style fields. We don't reject
# unknown values (forwards-compat), but warn so typos surface.
_KNOWN_LANGUAGES = {"python", "node", "rust", "docker", "builtin"}
_KNOWN_INSTALL_KINDS = {"pip", "npm", "git", "docker", "builtin"}


@dataclass
class InstallSpec:
    """Resolved install instructions from package.yml's ``install`` block."""

    kind: str = "builtin"          # pip | npm | git | docker | builtin
    package_spec: Optional[str] = None  # e.g. "." or "uvicorn fastapi"
    # Future: requirements list, git URL, docker image, etc.


@dataclass
class EntrySpec:
    """How to run a single instance.

    For subprocess services, ``argv`` is the command line. For in-process
    services, ``module`` + ``class_name`` point at the Service subclass
    inside <repo>/<name>/<version>/<module>.py. The two are mutually
    exclusive in practice — InProcessAdapter and SubprocessAdapter pick
    different fields.
    """

    argv: List[str] = field(default_factory=list)
    module: Optional[str] = None       # e.g. 'clock' (relative to the version dir)
    class_name: Optional[str] = None   # e.g. 'ClockService'


@dataclass
class PackageManifest:
    """One service-version, parsed from a package.yml on disk.

    The ``dir`` field is the absolute path to ``<repo>/<name>/<version>/``
    and is computed by the scanner — package.yml itself never declares
    it.
    """

    name: str
    version: str
    dir: Path
    # Human-readable display title for the type. The UI shows this in the
    # catalog + palette when set; when empty it falls back to ``name`` (the
    # current behaviour). Unlike ``name`` — which is the dir key and stays
    # [A-Za-z0-9._-] — ``title`` is free-form (spaces, punctuation, casing).
    title: Optional[str] = None
    description: Optional[str] = None
    language: str = "builtin"
    status: str = "development"
    author: Optional[str] = None
    tags: List[str] = field(default_factory=list)
    # Capability interfaces this service implements. Other services
    # discover compatible peers by filtering for the interface name
    # (e.g. servo declares ``requires: [servo_controller]`` and the
    # UI shows any running service whose ``implements`` includes
    # ``servo_controller``). Free-form strings; convention is
    # snake_case nouns.
    implements: List[str] = field(default_factory=list)
    # Interfaces this service expects to attach to at runtime. The UI
    # uses this to gate the attach-controller dropdown — empty means
    # no attachments are required.
    requires: List[str] = field(default_factory=list)
    icon: Optional[str] = None     # filename relative to dir; None if no icon.svg
    bundled: bool = False
    # Singleton-per-process types (e.g. the runtime itself) allow at most
    # one service_proxy instance to exist. The catalog seeder auto-creates
    # that instance on startup; install rejects duplicates; uninstall
    # rejects the lone instance to prevent self-destruction.
    singleton: bool = False
    install: InstallSpec = field(default_factory=InstallSpec)
    entry: EntrySpec = field(default_factory=EntrySpec)
    wizard_install: List[Dict[str, Any]] = field(default_factory=list)
    wizard_config: List[Dict[str, Any]] = field(default_factory=list)
    # License notice/agreement the user must accept once before the type
    # installs. None = no license gate. Shown by the install wizard.
    license: Optional[str] = None
    # Optional frontend UI bundle shipped with this service (Option B —
    # see docs/TODO_SERVICE_UI_BUNDLES.md). Shape:
    #   {entry: "ui/dist/ui.js", css?: "ui/dist/ui.css", sdk: "^1.0"}
    # The host dynamically imports the built ESM at runtime; None means no
    # bundled UI (the host falls back to its static serviceViews registry
    # or a placeholder).
    ui: Optional[Dict[str, Any]] = None

    @property
    def id(self) -> str:
        """`<name>@<version>` — the catalog row key."""
        return f"{self.name}@{self.version}"

    @property
    def venv_dir(self) -> Path:
        """Where pip will land the type-wide venv. Per-type, shared by instances."""
        return self.dir / ".venv"

    @property
    def venv_bin(self) -> Path:
        # Windows venvs put binaries under Scripts/; everywhere else bin/.
        # Phase 6 is Linux-only so we keep it simple.
        return self.venv_dir / "bin"


# ─── parsing ──────────────────────────────────────────────────────────


def _parse_install(raw: Any) -> InstallSpec:
    if raw is None:
        return InstallSpec()
    if not isinstance(raw, dict):
        logger.warning("install block must be a mapping; got %r", type(raw).__name__)
        return InstallSpec()
    kind = str(raw.get("kind") or "builtin").lower()
    if kind not in _KNOWN_INSTALL_KINDS:
        logger.warning("unknown install.kind=%r", kind)
    return InstallSpec(
        kind=kind,
        package_spec=raw.get("package_spec") or raw.get("requirements_str"),
    )


def _parse_entry(raw: Any) -> EntrySpec:
    if raw is None:
        return EntrySpec()
    if not isinstance(raw, dict):
        logger.warning("entry block must be a mapping; got %r", type(raw).__name__)
        return EntrySpec()
    argv = raw.get("argv") or []
    if not isinstance(argv, list):
        logger.warning("entry.argv must be a list of strings")
        argv = []
    in_process = raw.get("in_process") or {}
    module: Optional[str] = None
    class_name: Optional[str] = None
    if isinstance(in_process, dict):
        if in_process.get("module") is not None:
            module = str(in_process["module"])
        if in_process.get("class") is not None:
            class_name = str(in_process["class"])
    return EntrySpec(
        argv=[str(x) for x in argv],
        module=module,
        class_name=class_name,
    )


def _parse_manifest(path: Path, name: str, version: str) -> Optional[PackageManifest]:
    """Parse one package.yml. Returns None on hard errors (file missing,
    invalid yaml, name/version mismatch); soft errors are logged and the
    manifest still returned with best-effort defaults."""
    try:
        raw = yaml.safe_load(path.read_text())
    except (OSError, yaml.YAMLError) as exc:
        logger.warning("repo.scan: failed to read %s: %s", path, exc)
        return None
    if not isinstance(raw, dict):
        logger.warning("repo.scan: %s is not a yaml mapping", path)
        return None

    declared_name = raw.get("name")
    if declared_name and declared_name != name:
        logger.warning(
            "repo.scan: %s declares name=%r but its parent dir is %r — using the dir name",
            path, declared_name, name,
        )

    language = str(raw.get("language") or "builtin").lower()
    if language not in _KNOWN_LANGUAGES:
        logger.warning("repo.scan: %s unknown language=%r", path, language)

    icon_field = raw.get("icon")
    icon_path = path.parent / (icon_field or ICON_FILENAME)
    icon_present = icon_path.is_file()

    return PackageManifest(
        name=name,
        version=version,
        dir=path.parent,
        title=(str(raw["title"]).strip() or None) if raw.get("title") is not None else None,
        description=raw.get("description"),
        language=language,
        status=str(raw.get("status") or "development").lower(),
        author=raw.get("author"),
        tags=list(raw.get("tags") or []),
        implements=[str(x) for x in (raw.get("implements") or [])],
        requires=[str(x) for x in (raw.get("requires") or [])],
        icon=(icon_field or ICON_FILENAME) if icon_present else None,
        bundled=bool(raw.get("bundled", False)),
        singleton=bool(raw.get("singleton", False)),
        install=_parse_install(raw.get("install")),
        entry=_parse_entry(raw.get("entry")),
        wizard_install=list(raw.get("wizard_install") or []),
        wizard_config=list(raw.get("wizard_config") or []),
        license=raw.get("license"),
        ui=raw.get("ui") if isinstance(raw.get("ui"), dict) else None,
    )


# ─── scanning ─────────────────────────────────────────────────────────


def scan_repo(repo_dir: Path) -> List[PackageManifest]:
    """Walk ``<repo>/<name>/<version>/package.yml`` and return manifests.

    Skips broken manifests silently (warns); never raises. An empty repo
    returns an empty list.
    """
    if not repo_dir.is_dir():
        logger.info("repo.scan: %s not a directory; empty catalog", repo_dir)
        return []

    out: List[PackageManifest] = []
    for name_dir in sorted(repo_dir.iterdir()):
        if not name_dir.is_dir() or name_dir.name.startswith("."):
            continue
        name = name_dir.name
        for version_dir in sorted(name_dir.iterdir()):
            if not version_dir.is_dir() or version_dir.name.startswith("."):
                continue
            manifest_path = version_dir / PACKAGE_MANIFEST_FILE
            if not manifest_path.is_file():
                continue
            m = _parse_manifest(manifest_path, name, version_dir.name)
            if m is not None:
                out.append(m)
    logger.info("repo.scan: found %d service-versions under %s", len(out), repo_dir)
    return out


# ─── multi-root resolution ────────────────────────────────────────────
# A runtime can reference several local repo roots: the WRITABLE root
# (config.repo_dir — where loads extract + installs build venvs) plus
# any number of READ-ONLY roots (config.repo_paths — e.g. a separate
# public robotlab_x-services checkout, a private services dir). These
# helpers take ``settings`` explicitly so this module stays free of a
# config import (it's imported early in the boot graph).


def _resolve_repo_path(raw: str) -> Path:
    """CWD-relative + ~ expansion, matching the per-caller resolution
    that used to be duplicated across the runtime."""
    p = Path(str(raw)).expanduser()
    if not p.is_absolute():
        p = Path.cwd() / p
    return p.resolve()


def writable_repo_dir(settings: Any) -> Path:
    """The single WRITABLE repo root. Loads extract here and installs
    build their per-type ``.venv`` here. Mirrors ``config.repo_dir``
    (dev: ``./repo``; frozen bundle: ``var/repo``)."""
    return _resolve_repo_path(getattr(settings, "repo_dir", None) or "repo")


def repo_roots(settings: Any) -> List[Path]:
    """Ordered, de-duped repo roots to scan. The writable root comes
    FIRST so an installed/edited copy of a type shadows any read-only
    source of the same ``name@version``; ``config.repo_paths`` follow in
    listed order. With no ``repo_paths`` (the dev default) this is just
    ``[writable]`` — single-root behaviour, unchanged."""
    roots: List[Path] = [writable_repo_dir(settings)]
    for raw in (getattr(settings, "repo_paths", None) or []):
        if not raw:
            continue
        p = _resolve_repo_path(raw)
        if p not in roots:
            roots.append(p)
    return roots


def root_of(manifest: PackageManifest) -> Path:
    """The repo root a manifest was scanned from:
    ``<root>/<name>/<version>/`` → ``<root>``."""
    return manifest.dir.parent.parent


def scan_repos(roots: List[Path]) -> List[PackageManifest]:
    """Scan several roots in precedence order. The first occurrence of a
    given ``name@version`` wins — earlier roots shadow later ones."""
    seen: set = set()
    out: List[PackageManifest] = []
    for root in roots:
        for m in scan_repo(root):
            if m.id in seen:
                continue
            seen.add(m.id)
            out.append(m)
    return out


def find_type_dir(settings: Any, name: str, version: str) -> Optional[Path]:
    """Locate ``<root>/<name>/<version>/`` across all repo roots in
    precedence order. Returns the directory, or None if the type is
    absent from every root."""
    for root in repo_roots(settings):
        cand = root / name / version
        if (cand / PACKAGE_MANIFEST_FILE).is_file():
            return cand
    return None


# ─── transformations downstream callers want ──────────────────────────


def is_installed(m: PackageManifest) -> bool:
    """Is this type ready to start instances of?

    Bundled services with install.kind=builtin are always considered
    installed (they run inside the backend). Subprocess services need
    their venv on disk.
    """
    if m.install.kind == "builtin":
        return True
    return m.venv_bin.exists()


def manifest_to_service_meta(m: PackageManifest) -> Dict[str, Any]:
    """Project a manifest into the shape expected by the service_meta table.

    The DB schema predates package.yml; this is the adapter layer. We
    keep both `package_spec` and `entry_argv` for backward compat with
    Phase 6's lifecycle code, plus the new fields when consumers want
    richer info. We piggy-back `singleton` into the existing
    ``installation_exception`` slot until the model gets a dedicated
    column — keep callers consulting m.singleton via the manifest, not
    the DB row.
    """
    record: Dict[str, Any] = {
        "id": m.id,
        "name": m.name,
        "title": m.title,
        "version": m.version,
        "description": m.description,
        "language": m.language,
        "status": m.status,
        "author": m.author,
        "tags": m.tags,
        "installed": is_installed(m),
        # install_phase is reconciled from disk state on every boot: a
        # type with its venv (or a builtin) is "installed", everything
        # else on disk is "loaded". ABSENT (no row) is the implicit state
        # for types known only to a remote registry. The registry
        # transitions (runtime/registry.py) own the transient "installing"
        # / "failed" phases between reconciles. We clear load_error /
        # install_error here so a reboot makes a previously-failed install
        # retryable as "loaded" rather than sticking on a stale error.
        "install_phase": "installed" if is_installed(m) else "loaded",
        "load_error": None,
        "install_error": None,
        "bundled": bool(m.bundled),
        "dependency_manager": m.install.kind if m.install.kind != "builtin" else None,
        "package_spec": m.install.package_spec,
        "entry_argv": list(m.entry.argv) if m.entry.argv else None,
        "entry_in_process": (
            {"module": m.entry.module, "class": m.entry.class_name}
            if m.entry.module or m.entry.class_name
            else None
        ),
        "is_dockerized": m.install.kind == "docker",
        "wizard_steps": m.wizard_install or None,
        "config_steps": m.wizard_config or None,
        "license": m.license or None,
        "implements": list(m.implements),
        "requires": list(m.requires),
        "ui": m.ui,
    }
    # Surface singleton as a tag the UI can read without schema changes.
    if m.singleton and "singleton" not in record["tags"]:
        record["tags"] = list(record["tags"]) + ["singleton"]
    return record


def latest_per_name(manifests: List[PackageManifest]) -> List[PackageManifest]:
    """Collapse a list to one manifest per name — the latest version.

    Used by the palette ("latest only" decision). Version comparison is
    PEP 440 if the packaging lib is available; lexicographic fallback
    otherwise. Lexicographic is wrong for >9 majors but fine for the
    short-term reality of 1.x services.
    """
    try:
        from packaging.version import Version

        def key(v: str):
            try:
                return Version(v)
            except Exception:
                return Version("0.0.0")
    except ImportError:
        def key(v: str):
            return v

    by_name: Dict[str, PackageManifest] = {}
    for m in manifests:
        existing = by_name.get(m.name)
        if existing is None or key(m.version) > key(existing.version):
            by_name[m.name] = m
    return list(by_name.values())


def to_dict(m: PackageManifest) -> Dict[str, Any]:
    """JSON-safe dict for logging or testing."""
    d = asdict(m)
    d["dir"] = str(m.dir)
    return d
