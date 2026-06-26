# managed
"""Thin wrapper around auth.registration_flow.verify_and_register.

The canonical Registration → User flow lives in the auth package. This
file's only job is to supply the db handle, hand over the app's
event_handlers module so its hooks (on_verify_registration etc.) can be
discovered, and wrap the result in the app's ServiceResponseMessage.

Any specialized behavior — role assignment, tenant creation, custom user
fields — belongs in robotlab_x.event_handlers, NOT here. This file does
not reference the `tenant` table, the `role` table, or any field other
than what auth.registration_flow already understands.
"""
import logging

from auth.registration_flow import verify_and_register as _flow_verify
from database.factory import get_database_client
import robotlab_x.event_handlers as _handlers
from robotlab_x.service_response import ServiceResponseMessage, info_message

logger = logging.getLogger(__name__)


def verify_and_register(token: str) -> ServiceResponseMessage:
    """Resolve a verification token to a verified user.

    Delegates the heavy lifting to ``auth.registration_flow``. App-specific
    logic (roles, tenant linkage, custom fields) is invoked via the
    ``on_verify_registration`` hook in ``robotlab_x.event_handlers``.
    """
    db = get_database_client()
    if not db:
        raise ValueError("verify database not configured")

    result = _flow_verify(db, token, hook_module=_handlers)
    return info_message(result["message"])
