# Session lifetime policy — single source of truth for all auth types.
# Server and client both derive their constants from here (or the TS mirror below).
# All values in seconds unless the name ends in _MS.

ACCESS_TOKEN_TTL_SECONDS: int = 3600           # 1 hour; used by local_auth JWT signing
REFRESH_TOKEN_TTL_MS: int = 30 * 24 * 3600 * 1000  # 30-day refresh window
SESSION_MAX_LIFETIME_MS: int = 12 * 3600 * 1000    # Hard max from initial login
INACTIVITY_TIMEOUT_MS: int = 30 * 60 * 1000        # 30-min client-side inactivity
SILENT_REFRESH_LEEWAY_SECONDS: int = 120            # Refresh 2 min before token expiry
