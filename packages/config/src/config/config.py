"""
Shared configuration package for cloudseeder FastAPI applications and packages.
"""
from typing import Dict, Any, Callable, Type
from pydantic_settings import BaseSettings
from dotenv import load_dotenv
import os
import json
import logging
from pydantic import ConfigDict
from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger(__name__)

# Internal cache for singleton behavior
_settings_cache = {}

# Contract: Each app supplies its app_name and its Pydantic config model (Config)
# Usage: settings, config_provider = create_app_settings("property_scout", PropertyScoutConfig)

def create_app_settings(
    app_name: str,
    config_class: Type[BaseSettings],
    env_file: str = ".env"
) -> tuple[BaseSettings, Callable[[], Dict[str, Any]]]:
    """
    Factory to create an app's settings and a config_provider for DI, using normalized env_prefix and env_file.
    Singleton: returns the same instance for each unique (app_name, config_class, env_file).
    """
    # cache_key = (app_name, config_class, env_file)
    cache_key = (app_name, config_class)
    if cache_key in _settings_cache:
        return _settings_cache[cache_key]

    env_file_path = env_file if env_file else None
    env_file_exists = bool(env_file_path) and os.path.exists(env_file_path)
    if env_file_exists:
        load_dotenv(env_file_path)  # Do NOT override existing env vars
    else:
        logger.info("Env file not found; using defaults and existing environment variables.")

    # Use config_class as-is, ensuring it inherits from BaseSettings
    settings = config_class()

    # Check if any field needs encryption/decryption before requiring PRIVATE_KEY
    encrypt_fields = []
    decrypt_fields = []
    for field_name in config_class.model_fields:
        raw_value = getattr(settings, field_name)
        if isinstance(raw_value, str):
            value_stripped = raw_value.strip()
            # Handle quoted Encrypt--
            if (value_stripped.startswith('"Encrypt--') and value_stripped.endswith('"')) or \
               (value_stripped.startswith("'Encrypt--") and value_stripped.endswith("'")):
                quote = value_stripped[0]
                inner = value_stripped[1:-1]
                if inner.startswith('Encrypt--'):
                    encrypt_fields.append((field_name, inner, quote))
            elif value_stripped.startswith('Encrypt--'):
                encrypt_fields.append((field_name, value_stripped, ''))
            # Handle quoted Encrypted--
            elif (value_stripped.startswith('"Encrypted--') and value_stripped.endswith('"')) or \
                 (value_stripped.startswith("'Encrypted--") and value_stripped.endswith("'")):
                quote = value_stripped[0]
                inner = value_stripped[1:-1]
                if inner.startswith('Encrypted--'):
                    decrypt_fields.append((field_name, inner, quote))
            elif value_stripped.startswith('Encrypted--'):
                decrypt_fields.append((field_name, value_stripped, ''))

    # Fernet key resolution: .private.key file, then env var
    fernet_key = None
    key_source = None
    key_path = os.path.join(os.getcwd(), '.private.key')
    if os.path.exists(key_path):
        if os.path.isfile(key_path):
            with open(key_path, 'r') as f:
                fernet_key = f.read().strip()
            key_source = '.private.key file'
        else:
            logger.warning("Expected .private.key to be a file, but found a directory: %s", key_path)
    if os.environ.get('PRIVATE_KEY'):
        fernet_key = os.environ['PRIVATE_KEY']
        key_source = 'PRIVATE_KEY env var'

    # If Encrypt-- and no key, generate a .private.key
    generated_key = None
    if encrypt_fields and not fernet_key:
        generated_key = Fernet.generate_key().decode()
        with open(key_path, 'w') as f:
            f.write(generated_key)
        logger.warning(f"No Fernet key found. Generated new .private.key: {key_path}\nKey: {generated_key}")
        fernet_key = generated_key
        key_source = 'generated .private.key'

    fernet = Fernet(fernet_key.encode()) if fernet_key else None

    # Encrypt values if needed
    if encrypt_fields:
        for field_name, raw_value, quote in encrypt_fields:
            plaintext = raw_value[len('Encrypt--'):].encode()
            encrypted = fernet.encrypt(plaintext).decode() if fernet else None
            encrypted_value = f'{quote}Encrypted--{encrypted}{quote}' if encrypted else None
            logger.info(f"Field '{field_name}' encrypted as: {encrypted_value if encrypted_value else '[NO KEY AVAILABLE]'}")
        raise RuntimeError('One or more config values need to be encrypted. See logs for Encrypted-- values. Please update your .env or config and restart.')

    # Decrypt values if needed
    for field_name, raw_value, quote in decrypt_fields:
        if not fernet:
            raise RuntimeError(f"Encrypted value for field '{field_name}' found, but no Fernet key available. Set PRIVATE_KEY or provide .private.key.")
        encrypted_part = raw_value[len('Encrypted--'):]
        try:
            decrypted_value = fernet.decrypt(encrypted_part.encode()).decode()
            setattr(settings, field_name, f'{quote}{decrypted_value}{quote}')
        except InvalidToken:
            logger.error(f"Failed to decrypt field '{field_name}': Invalid token")

    result = (settings, lambda: settings.model_dump())
    _settings_cache[cache_key] = result

    redacted_fields = {field_name for field_name, _, _ in decrypt_fields}
    loggable = {
        k: ("****" if k in redacted_fields else v)
        for k, v in settings.model_dump().items()
    }
    logger.info(f"Creating Settings: {json.dumps(loggable, indent=2, sort_keys=True)}")
    return result

def get_settings() -> BaseSettings:
    """
    Returns the singleton settings instance if set, otherwise raises an error.
    """
    if not _settings_cache:
        raise RuntimeError("Settings cache has not been set. Call create_app_settings() first.")
    # Return the first (and only) settings instance
    return next(iter(_settings_cache.values()))[0]

def destroy_settings():
    """
    Clears the settings cache and resets all state information.
    Use this to fully reset configuration state (e.g., for testing).
    """
    _settings_cache.clear()

# For packages (auth, database, queues, mail):
# They should accept a config_provider: Callable[[], Dict[str, Any]]
# and use it to access config values, remaining decoupled from app specifics.
