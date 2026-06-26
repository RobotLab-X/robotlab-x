# managed
from robotlab_x.api.crud_router_factory import create_crud_router
from robotlab_x.models.link import Link


router = create_crud_router(
    model_cls=Link,
    resource_slug="v1/links",
    service_resource="link",
    service_module="robotlab_x.services.link_service",
    roles=['Admin'],
    methods=['list', 'request'],
    list_at_root=True,
)
