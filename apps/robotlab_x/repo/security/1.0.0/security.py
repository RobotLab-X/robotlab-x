# unmanaged
"""SecurityService — singleton crypto service.

The second framework singleton (after ``runtime``). Auto-started by the
config-set loader BEFORE any service whose config carries an
``Encrypted--`` field that needs decryption.

Bus actions
-----------
  /security/security-1/control  <- {"action": "encrypt", "plaintext": "...", "reply_to": ...}
                                 | {"action": "decrypt", "ciphertext": "Encrypted--...", "reply_to": ...}
                                 | {"action": "status", "reply_to": ...}

Wire format
-----------
  ``Encrypt--foo``   operator-typed plaintext seed. The loader walks
                     yml leaves on save and rewrites this prefix as
                     ``Encrypted--<token>``. Inside the running service
                     the value is the plain ``foo``.
  ``Encrypted--xxx`` what gets written to yml. ``xxx`` is a Fernet token
                     (url-safe base64 with MAC).

Key material
------------
  Resolution order (highest priority first):
    1. ``override_key`` argument to SecurityCore (tests use this)
    2. ``$ROBOTLAB_X_SECURITY_KEY`` env var
    3. ``<data_dir>/security/key.bin`` (file)
    4. Generate new key + write to (3) with mode 0o600

  Fernet keys are 32 bytes, url-safe base64 encoded (Fernet's own format).
  Crypto: AES-128-CBC + HMAC-SHA256. Lose the key file = lose every
  Encrypted-- value across every config set. Back it up.

Failure modes
-------------
  * Bad ciphertext (tampered / wrong key) → decrypt action returns
    ``{"error": "..."}``. SecurityCore.decrypt raises InvalidToken
    so direct callers can distinguish corruption from missing prefix.
  * Plaintext starting with neither prefix → encrypt treats the whole
    string as plaintext. Friendly to callers that don't know the
    prefix convention.
  * Already-Encrypted-- input to encrypt → returned unchanged
    (idempotent), so the loader can walk a config tree blindly.
"""
from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from typing import Any, Dict, Optional

from cryptography.fernet import Fernet, InvalidToken
from pydantic import Field
from rlx_bus import ServiceConfig
from robotlab_x.framework import Service, service_method


logger = logging.getLogger(__name__)


ENCRYPT_PREFIX = "Encrypt--"      # operator-typed plaintext seed marker
ENCRYPTED_PREFIX = "Encrypted--"  # round-tripped ciphertext marker


# ─── core (no framework deps; testable in isolation) ──────────────────


class SecurityCore:
    """Symmetric crypto + key management.

    Holds one Fernet instance. Constructor loads the key from
    (in priority order):
      1. ``override_key`` argument (tests, ops automation)
      2. ``env_var`` if set in the environment
      3. The key file at ``key_path``, if it exists
      4. Generate a new key + write to ``key_path`` (mode 0o600)

    No async, no bus — pure crypto. The service wrapper below adds the
    @service_method actions.
    """

    def __init__(
        self,
        *,
        key_path: Path,
        override_key: Optional[str] = None,
        env_var: str = "ROBOTLAB_X_SECURITY_KEY",
    ):
        self.key_path = key_path
        self._key_source: str = "?"
        key_bytes = self._resolve_key(override_key, env_var)
        self._fernet = Fernet(key_bytes)

    def _resolve_key(self, override_key: Optional[str], env_var: str) -> bytes:
        if override_key:
            self._key_source = "override"
            return (
                override_key.encode("ascii")
                if isinstance(override_key, str)
                else override_key
            )
        env_value = os.environ.get(env_var)
        if env_value:
            self._key_source = f"env:{env_var}"
            return env_value.encode("ascii")
        if self.key_path.is_file():
            self._key_source = f"file:{self.key_path}"
            return self.key_path.read_bytes().strip()
        # Generate. Write atomically + restrict permissions BEFORE the
        # rename so there's never a window where a 0o644 file exists at
        # the final path.
        self.key_path.parent.mkdir(parents=True, exist_ok=True)
        key = Fernet.generate_key()
        tmp = self.key_path.with_suffix(self.key_path.suffix + ".tmp")
        tmp.write_bytes(key)
        os.chmod(tmp, 0o600)
        tmp.rename(self.key_path)
        self._key_source = f"file:{self.key_path}(generated)"
        logger.info("security: generated new key at %s (0o600)", self.key_path)
        return key

    @property
    def key_source(self) -> str:
        """Where the live key came from. ``override`` | ``env:<name>`` |
        ``file:<path>`` | ``file:<path>(generated)``. Useful for audit."""
        return self._key_source

    def encrypt(self, plaintext: str) -> str:
        """Encrypt a plaintext string. Returns ``Encrypted--<token>``.

        * Strips the ``Encrypt--`` prefix if present — that prefix is
          the operator-friendly seed marker, not part of the secret.
        * Idempotent on already-encrypted input: returns unchanged if
          input already starts with ``Encrypted--``. Lets the loader
          walk a config tree without per-leaf prefix checks.
        """
        if plaintext.startswith(ENCRYPTED_PREFIX):
            return plaintext  # already encrypted; pass through
        if plaintext.startswith(ENCRYPT_PREFIX):
            plaintext = plaintext[len(ENCRYPT_PREFIX):]
        token = self._fernet.encrypt(plaintext.encode("utf-8")).decode("ascii")
        return f"{ENCRYPTED_PREFIX}{token}"

    def decrypt(self, ciphertext: str) -> str:
        """Decrypt an ``Encrypted--<token>`` string.

        Raises:
          ValueError      — input doesn't start with ``Encrypted--``
          InvalidToken    — token can't be decrypted with current key
                            (tampered, wrong key, or corrupt)
        """
        if not ciphertext.startswith(ENCRYPTED_PREFIX):
            raise ValueError(
                f"decrypt: input must start with {ENCRYPTED_PREFIX!r} "
                f"(got {ciphertext[:20]!r}...)"
            )
        token = ciphertext[len(ENCRYPTED_PREFIX):]
        plaintext_bytes = self._fernet.decrypt(token.encode("ascii"))
        return plaintext_bytes.decode("utf-8")


# ─── module-level access for the loader (stone 2) ─────────────────────


_current: Optional["SecurityService"] = None


def get_security_service() -> Optional["SecurityService"]:
    """Return the running SecurityService instance, if any.

    The config-set loader (stone 2) uses this to round-trip
    ``Encrypted--`` leaves at load time without going through the bus
    — it's in the same process, no point paying the round-trip cost.

    Returns ``None`` if security hasn't started yet (boot-ordering
    bug) or has shut down.
    """
    return _current


# ─── service wrapper ──────────────────────────────────────────────────


class SecurityConfig(ServiceConfig):
    """Per-instance config. Defaults work; operators rarely override."""
    key_path: Optional[str] = Field(
        None,
        description="Absolute path to the key file. Defaults to "
                    "<data_dir>/security/key.bin.",
    )
    env_var: str = Field(
        "ROBOTLAB_X_SECURITY_KEY",
        description="Env var name checked for a key override before "
                    "reading the key file. Useful for CI / ops automation.",
    )


class SecurityService(Service):
    """Singleton crypto service. One per backend process."""

    config_class = SecurityConfig
    publishes = ["state"]
    _core: SecurityCore
    _control_task: Optional[asyncio.Task] = None

    async def on_start(self) -> None:
        global _current
        key_path = self._resolve_key_path()
        self._core = SecurityCore(
            key_path=key_path,
            env_var=self.config.env_var,
        )
        _current = self
        # Retained state — operators can see where the key came from
        # without being able to read it. Never publishes the key itself.
        self.publish(
            "state",
            {"ready": True, "key_source": self._core.key_source},
            retained=True,
        )
        self._control_task = asyncio.create_task(self.run_control_loop())

    async def on_stop(self) -> None:
        global _current
        if _current is self:
            _current = None
        task = self._control_task
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass

    # ─── @service_method actions ──────────────────────────────────

    @service_method("encrypt")
    def m_encrypt(self, plaintext: str) -> Dict[str, Any]:
        """Encrypt a plaintext string. Returns
        ``{"ciphertext": "Encrypted--<token>"}``."""
        if not isinstance(plaintext, str):
            return {"error": f"plaintext must be a string, got {type(plaintext).__name__}"}
        return {"ciphertext": self._core.encrypt(plaintext)}

    @service_method("decrypt")
    def m_decrypt(self, ciphertext: str) -> Dict[str, Any]:
        """Decrypt an ``Encrypted--`` prefixed token. Returns
        ``{"plaintext": ...}`` on success, ``{"error": ...}`` on bad
        input. Never raises — the bus action is friendly."""
        if not isinstance(ciphertext, str):
            return {"error": f"ciphertext must be a string, got {type(ciphertext).__name__}"}
        try:
            return {"plaintext": self._core.decrypt(ciphertext)}
        except ValueError as exc:
            return {"error": str(exc)}
        except InvalidToken:
            return {"error": "invalid or tampered ciphertext (wrong key or corrupt)"}

    @service_method("status")
    def m_status(self) -> Dict[str, Any]:
        """Audit endpoint — where is the key coming from?"""
        return {
            "ready": True,
            "key_source": self._core.key_source,
            "key_path": str(self._core.key_path),
        }

    # ─── internals ────────────────────────────────────────────────

    def _resolve_key_path(self) -> Path:
        if self.config.key_path:
            return Path(self.config.key_path).expanduser().resolve()
        from config import get_settings
        settings = get_settings()
        data_dir = Path(getattr(settings, "data_dir", None) or "data")
        if not data_dir.is_absolute():
            data_dir = Path.cwd() / data_dir
        return (data_dir / "security" / "key.bin").resolve()
