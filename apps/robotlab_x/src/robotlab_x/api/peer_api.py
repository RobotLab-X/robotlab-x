# managed
from robotlab_x.api.crud_router_factory import create_crud_router
from robotlab_x.models.peer import Peer


router = create_crud_router(
    model_cls=Peer,
    resource_slug="v1/peers",
    service_resource="peer",
    service_module="robotlab_x.services.peer_service",
    roles=['Admin'],
    methods=['list', 'request'],
    list_at_root=True,
)
