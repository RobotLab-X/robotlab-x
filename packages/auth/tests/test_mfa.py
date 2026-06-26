import pytest
from auth.mfa import generate_totp_secret, get_totp_uri, generate_qr_code, verify_totp


def test_generate_totp_secret_length():
    secret = generate_totp_secret("testuser")
    # pyotp.random_base32() returns a 32-character string
    assert isinstance(secret, str)
    assert len(secret) == 32

def test_get_totp_uri():
    secret = generate_totp_secret("alice")
    uri = get_totp_uri("alice", secret, issuer="TestApp")
    assert uri.startswith("otpauth://totp/")
    assert "TestApp" in uri
    assert secret in uri

def test_generate_qr_code_returns_streaming_response():
    secret = generate_totp_secret("bob")
    uri = get_totp_uri("bob", secret)
    response = generate_qr_code(uri)
    # Should be a StreamingResponse
    from fastapi.responses import StreamingResponse
    assert isinstance(response, StreamingResponse)
    # Should have correct media type
    assert response.media_type == "image/png"

def test_verify_totp_success_and_failure():
    import pyotp
    secret = generate_totp_secret("eve")
    totp = pyotp.TOTP(secret)
    code = totp.now()
    # Should verify current code
    assert verify_totp(secret, code)
    # Should fail for wrong code
    assert not verify_totp(secret, "123456")
