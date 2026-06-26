import os
import tempfile
import pytest
from pydantic import BaseModel, ConfigDict
from pydantic_settings import BaseSettings
from config import create_app_settings
from config.config import get_settings, destroy_settings

# Use a Pydantic BaseSettings class for DummyConfig to ensure compatibility with config loader
class DummyConfig(BaseSettings):
    foo: str = "bar"
    num: int = 42
    model_config = ConfigDict(
        env_prefix="DUMMY_",
        env_file=None,
        env_file_override_priority=True
    )

def test_create_app_settings_and_get_settings():
    destroy_settings()  # Ensure clean state
    settings, provider = create_app_settings("dummy", DummyConfig)
    assert settings.foo == "bar"
    assert settings.num == 42
    # get_settings should return the same instance
    settings2 = get_settings()
    assert settings2 is settings
    # provider returns a dict
    conf = provider()
    assert conf["foo"] == "bar"
    assert conf["num"] == 42

def test_destroy_settings():
    destroy_settings()
    with pytest.raises(RuntimeError):
        get_settings()

def test_create_app_settings_loads_env():
    destroy_settings()
    class DummyConfig(BaseSettings):
        foo: str = "bar"
        port: int = 1234
        model_config = ConfigDict(
            env_prefix="DUMMYAPP_",
            env_file=None,
            env_file_override_priority=True
        )
    with tempfile.NamedTemporaryFile(mode="w", delete=False) as tmp:
        tmp.write("DUMMYAPP_FOO=fromenv\nDUMMYAPP_PORT=5678\n")
        tmp_path = tmp.name
    try:
        settings, provider = create_app_settings("dummyapp", DummyConfig, env_file=tmp_path)
        assert settings.foo == "fromenv"
        assert settings.port == 5678
        assert provider()["foo"] == "fromenv"
        assert provider()["port"] == 5678
        s = get_settings()
        assert s.foo == "fromenv"
        assert s.port == 5678
    finally:
        os.remove(tmp_path)
        destroy_settings()

def test_get_settings_raises_if_not_set(monkeypatch):
    destroy_settings()
    from config import config as config_mod
    config_mod._settings_cache.clear()
    with pytest.raises(RuntimeError):
        get_settings()

def test_singleton_behavior():
    destroy_settings()
    class DummyConfig(BaseModel):
        foo: str = "bar"
    s1, _ = create_app_settings("singletonapp", DummyConfig)
    s2, _ = create_app_settings("singletonapp", DummyConfig)
    settings = get_settings()
    assert settings.foo == "bar"
    assert s1 is s2

def test_different_app_name_or_class_gives_different_singleton():
    destroy_settings()
    class DummyConfigA(BaseModel):
        foo: str = "bar"
    class DummyConfigB(BaseModel):
        bar: str = "baz"
    s1, _ = create_app_settings("app1", DummyConfigA)
    s2, _ = create_app_settings("app2", DummyConfigA)
    s3, _ = create_app_settings("app1", DummyConfigB)
    assert s1 is not s2
    assert s1 is not s3

def test_destroy_settings_clears_cache():
    destroy_settings()
    class DummyConfig(BaseModel):
        foo: str = "bar"
    create_app_settings("destroytest", DummyConfig)
    assert get_settings().foo == "bar"
    destroy_settings()
    with pytest.raises(RuntimeError):
        get_settings()

def test_precedence_env_overrides_env_file_and_default():
    destroy_settings()
    class DummyConfig(BaseSettings):
        foo: str = "defaultfoo"
        port: int = 1234
        model_config = ConfigDict(
            env_prefix="DUMMYAPP_",
            env_file=None,
            env_file_override_priority=True
        )
    # Write .env file with values
    with tempfile.NamedTemporaryFile(mode="w", delete=False) as tmp:
        tmp.write("DUMMYAPP_FOO=fromenvfile\nDUMMYAPP_PORT=5678\n")
        tmp_path = tmp.name
    try:
        # Set env var to override .env
        os.environ["DUMMYAPP_FOO"] = "fromenvvar"
        os.environ["DUMMYAPP_PORT"] = "9999"
        settings, _ = create_app_settings("dummyapp", DummyConfig, env_file=tmp_path)
        assert settings.foo == "fromenvvar"
        assert settings.port == 9999
    finally:
        os.remove(tmp_path)
        del os.environ["DUMMYAPP_FOO"]
        del os.environ["DUMMYAPP_PORT"]
        destroy_settings()

def test_precedence_env_file_overrides_default():
    destroy_settings()
    class DummyConfig(BaseSettings):
        foo: str = "defaultfoo"
        port: int = 1234
        model_config = ConfigDict(
            env_prefix="DUMMYAPP_",
            env_file=None,
            env_file_override_priority=True
        )
    with tempfile.NamedTemporaryFile(mode="w", delete=False) as tmp:
        tmp.write("DUMMYAPP_FOO=fromenvfile\nDUMMYAPP_PORT=5678\n")
        tmp_path = tmp.name
    try:
        # No env var set
        settings, _ = create_app_settings("dummyapp", DummyConfig, env_file=tmp_path)
        assert settings.foo == "fromenvfile"
        assert settings.port == 5678
    finally:
        os.remove(tmp_path)
        # Clean up any env vars set by dotenv
        os.environ.pop("DUMMYAPP_FOO", None)
        os.environ.pop("DUMMYAPP_PORT", None)
        destroy_settings()

def test_precedence_default_when_no_env_or_file():
    destroy_settings()
    # Remove any lingering .env files in cwd that could affect test
    if os.path.exists(".env"):
        os.remove(".env")
    # Clean up any env vars set by previous tests
    os.environ.pop("DUMMYAPP_FOO", None)
    os.environ.pop("DUMMYAPP_PORT", None)
    class DummyConfig(BaseSettings):
        foo: str = "defaultfoo"
        port: int = 1234
        model_config = ConfigDict(
            env_prefix="DUMMYAPP_",
            env_file=None,
            env_file_override_priority=True
        )
    # No env var, no env file
    settings, _ = create_app_settings("dummyapp", DummyConfig)
    assert settings.foo == "defaultfoo"
    assert settings.port == 1234
    destroy_settings()
