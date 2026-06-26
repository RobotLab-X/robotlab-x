# managed
from robotlab_x.api.crud_router_factory import create_crud_router
from robotlab_x.models.service_config import ServiceConfig


router = create_crud_router(
    model_cls=ServiceConfig,
    resource_slug="service-config",
    service_resource="service_config",
    service_module="robotlab_x.services.service_config_service",
    roles=['Admin'],
    methods=None,
)
