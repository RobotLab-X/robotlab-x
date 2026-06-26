# managed
from robotlab_x.api.crud_router_factory import create_crud_router
from robotlab_x.models.config import Config


router = create_crud_router(
    model_cls=Config,
    resource_slug="config",
    service_resource="config",
    service_module="robotlab_x.services.config_service",
    roles=['Admin'],
    methods=None,
)
