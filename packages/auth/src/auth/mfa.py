# mfa.py
import io
from fastapi.responses import StreamingResponse

def generate_totp_secret(username: str) -> str:
    import pyotp  # Dynamically import the pyotp library
    return pyotp.random_base32()

def get_totp_uri(username: str, secret: str, issuer: str = "App") -> str:
    import pyotp  # Dynamically import the pyotp library
    return pyotp.totp.TOTP(secret).provisioning_uri(name=username, issuer_name=issuer)

def generate_qr_code(uri: str) -> StreamingResponse:
    import qrcode  # Dynamically import the qrcode library
    img = qrcode.make(uri)
    buf = io.BytesIO()
    img.save(buf)
    buf.seek(0)
    return StreamingResponse(buf, media_type="image/png")

def verify_totp(secret: str, code: int, valid_window: int = 5) -> bool:
    import pyotp  # Dynamically import the pyotp library
    return pyotp.totp.TOTP(secret).verify(code, valid_window=valid_window)