# managed
from typing import Optional, Literal, List, Dict, Any
from pydantic import Field
from models.auth_user import AuthUser

# User model inherits from standardized AuthUser
# All fields from AuthUser are automatically available
class User(AuthUser):

    pass
