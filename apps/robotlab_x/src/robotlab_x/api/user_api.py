# managed
from robotlab_x.api.crud_router_factory import create_crud_router
from robotlab_x.models.user import User


router = create_crud_router(
    model_cls=User,
    resource_slug="user",
    service_resource="user",
    service_module="robotlab_x.services.user_service",
    roles=['Admin'],
    methods=None,
)
