import os
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from datetime import datetime, timedelta, timezone

def generate_self_signed_cert(cert_file="ssl/cert.pem", key_file="ssl/key.pem"):
    """Generate a self-signed SSL certificate and private key if they do not exist."""
    
    # Check if the certificate and key already exist
    if os.path.exists(cert_file) and os.path.exists(key_file):
        print(f"Certificate and key already exist: {cert_file}, {key_file}")
        return

    # Create directories for certificate and key files if they don't exist
    cert_dir = os.path.dirname(cert_file)
    key_dir = os.path.dirname(key_file)
    
    if cert_dir:
        os.makedirs(cert_dir, exist_ok=True)
    if key_dir and key_dir != cert_dir:
        os.makedirs(key_dir, exist_ok=True)

    print("Generating new self-signed certificate...")

    # Generate private key
    key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=4096,
    )

    # Create certificate subject and issuer
    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, "US"),
        x509.NameAttribute(NameOID.STATE_OR_PROVINCE_NAME, "California"),
        x509.NameAttribute(NameOID.LOCALITY_NAME, "San Francisco"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "MyCompany"),
        x509.NameAttribute(NameOID.COMMON_NAME, "localhost"),
    ])

    # Define certificate validity period
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.now(timezone.utc))
        .not_valid_after(datetime.now(timezone.utc) + timedelta(days=365))  # 1 year validity
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .sign(key, hashes.SHA256())
    )

    # Write private key to file
    with open(key_file, "wb") as f:
        f.write(
            key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.TraditionalOpenSSL,
                encryption_algorithm=serialization.NoEncryption(),
            )
        )

    # Write certificate to file
    with open(cert_file, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))

    print(f"Self-signed certificate and key generated: {cert_file}, {key_file}")

# Run the function to generate certs if they don't exist
generate_self_signed_cert()
