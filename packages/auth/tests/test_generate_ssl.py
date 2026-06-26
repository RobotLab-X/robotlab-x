import os
import tempfile
import shutil
import pytest
from auth.generate_ssl import generate_self_signed_cert

def test_generate_self_signed_cert_creates_files():
    with tempfile.TemporaryDirectory() as tmpdir:
        cert_file = os.path.join(tmpdir, "test_cert.pem")
        key_file = os.path.join(tmpdir, "test_key.pem")
        # Ensure files do not exist
        assert not os.path.exists(cert_file)
        assert not os.path.exists(key_file)
        # Generate cert and key
        generate_self_signed_cert(cert_file=cert_file, key_file=key_file)
        # Files should now exist
        assert os.path.exists(cert_file)
        assert os.path.exists(key_file)
        # Check file contents are not empty
        assert os.path.getsize(cert_file) > 0
        assert os.path.getsize(key_file) > 0

def test_generate_self_signed_cert_idempotent():
    with tempfile.TemporaryDirectory() as tmpdir:
        cert_file = os.path.join(tmpdir, "test_cert.pem")
        key_file = os.path.join(tmpdir, "test_key.pem")
        # First call should create files
        generate_self_signed_cert(cert_file=cert_file, key_file=key_file)
        mtime1 = os.path.getmtime(cert_file)
        # Second call should not overwrite files
        generate_self_signed_cert(cert_file=cert_file, key_file=key_file)
        mtime2 = os.path.getmtime(cert_file)
        assert mtime1 == mtime2  # File not modified
