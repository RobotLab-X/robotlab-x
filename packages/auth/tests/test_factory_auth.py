from auth.factory import get_auth_provider
from auth.local_auth import LocalAuthProvider
from auth.none_auth import NoneAuthProvider
from auth.oauth_auth import OAuthAuthProvider


def test_factory_dispatches_oauth():
    provider = get_auth_provider(lambda: {"auth_type": "oauth"})
    assert isinstance(provider, OAuthAuthProvider)


def test_factory_dispatches_local():
    provider = get_auth_provider(lambda: {"auth_type": "local"})
    assert isinstance(provider, LocalAuthProvider)


def test_factory_dispatches_none():
    provider = get_auth_provider(lambda: {"auth_type": "none"})
    assert isinstance(provider, NoneAuthProvider)


def test_factory_rejects_unknown_auth_type():
    import pytest
    with pytest.raises(ValueError, match="Unsupported auth_type"):
        get_auth_provider(lambda: {"auth_type": "okta"})
