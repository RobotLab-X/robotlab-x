# managed
from robotlab_x.api.crud_router_factory import create_crud_router
from robotlab_x.models.registration import Registration


router = create_crud_router(
    model_cls=Registration,
    resource_slug="registration",
    service_resource="registration",
    service_module="robotlab_x.services.registration_service",
    roles=['Admin'],
    methods=None,
)
