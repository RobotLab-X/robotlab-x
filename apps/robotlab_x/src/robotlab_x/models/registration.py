# managed
from typing import Optional, Literal, List, Dict, Any
from pydantic import Field
from models.auth_registration import AuthRegistration

# Registration model inherits from standardized AuthRegistration
# This ensures consistent email verification flow across all apps
class Registration(AuthRegistration):

    pass
