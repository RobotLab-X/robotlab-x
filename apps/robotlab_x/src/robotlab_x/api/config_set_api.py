# managed
from robotlab_x.api.crud_router_factory import create_crud_router
from robotlab_x.models.config_set import ConfigSet


router = create_crud_router(
    model_cls=ConfigSet,
    resource_slug="v1/config-sets",
    service_resource="config_set",
    service_module="robotlab_x.services.config_set_service",
    roles=['Admin'],
    methods=['list', 'get_by_id', 'request'],
    list_at_root=True,
)
