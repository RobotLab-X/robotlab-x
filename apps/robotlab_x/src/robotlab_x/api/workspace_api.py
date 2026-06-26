# managed
from robotlab_x.api.crud_router_factory import create_crud_router
from robotlab_x.models.workspace import Workspace


router = create_crud_router(
    model_cls=Workspace,
    resource_slug="workspace",
    service_resource="workspace",
    service_module="robotlab_x.services.workspace_service",
    roles=['Admin'],
    methods=None,
)
