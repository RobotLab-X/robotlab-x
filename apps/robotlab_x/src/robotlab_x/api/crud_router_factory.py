# managed
import inspect
import logging
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Sequence, Set, Type, Union

from auth import create_auth_dependencies
from config import create_app_settings
from fastapi import APIRouter, Depends, Request, Response, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from invoker import safe_invoke
from robotlab_x.models.config import Config
from robotlab_x.service_response import ServiceResponseMessage, error_message

settings, config_provider = create_app_settings("robotlab_x", Config)
auth_deps = create_auth_dependencies(config_provider)
logger = logging.getLogger(__name__)


class RequestResponse(BaseModel):
    metadata: Dict[str, Any]
    records: List[Any]


def _handle_exception(action: str, slug: str, exc: Exception) -> JSONResponse:
    logger.error("Error during %s for %s: %s", action, slug, exc)
    logger.exception("Stack trace for %s %s", action, slug)
    error_msg = error_message(message=f"Error {action} {slug}", detail=str(exc))
    return JSONResponse(status_code=500, content=error_msg.model_dump())


def _normalize_result(ret: Any) -> Any:
    if isinstance(ret, Response):
        return ret
    if isinstance(ret, ServiceResponseMessage) and ret.status_code is not None and ret.status_code >= 300:
        return JSONResponse(status_code=ret.status_code, content=ret.model_dump())
    return ret


# ---------------------------------------------------------------------------
# Route registry — every route is a data row; no logic scattered in conditionals
# ---------------------------------------------------------------------------

# Backwards-compatible aliases: old names still accepted in methods= lists
_METHOD_ALIASES: Dict[str, str] = {
    "post":     "create",
    "get_id":   "get_by_id",
    "get_path": "get_by_path",
    "put":      "update",
}

# Named groups usable in methods= or __methods__: yaml
_METHOD_GROUPS: Dict[str, Set[str]] = {
    "read_only": {"list", "get", "get_by_id", "get_by_path"},
    "writable":  {"create", "update", "delete"},
    "all":       {"create", "list", "get", "get_by_id", "get_by_path", "update", "delete", "request"},
}


@dataclass
class RouteSpec:
    key: str        # canonical name
    http: str       # HTTP verb
    suffix: str     # path suffix template — {pk} is replaced with the record-ID param name
    svc_fn: str     # service function template — {s} is replaced with service_resource
    svc_args: list  # invocation arg list: 'item'|None|'{pk}'|'full_path'|'payload'|'user'|'req'
    res_model: str  # response model class: 'item' | 'write' | 'list' | 'request'
    check_404: bool # return 404 when service returns a falsy result


_ROUTES: List[RouteSpec] = [
    #                key           http      suffix                      svc_fn                    svc_args                               res_model   404
    RouteSpec("create",      "POST",   "",                     "create_{s}",          ["item",          "user", "req"],  "write",   False),
    RouteSpec("list",        "GET",    "-list",                "get_all_{s}",         [                 "user", "req"],  "list",    False),
    RouteSpec("get",         "GET",    "",                     "get_{s}",             [None,            "user", "req"],  "item",    True ),
    RouteSpec("get_by_id",   "GET",    "/{pk}",                "get_{s}",             ["{pk}",          "user", "req"],  "item",    True ),
    RouteSpec("get_by_path", "GET",    "-path/{full_path:path}","get_path_{s}",       ["full_path",     "user", "req"],  "item",    True ),
    RouteSpec("update",      "PUT",    "/{pk}",                "update_{s}",          ["{pk}", "item",  "user", "req"],  "write",   False),
    RouteSpec("delete",      "DELETE", "/{pk}",                "delete_{s}",          ["{pk}",          "user", "req"],  "write",   True ),
    RouteSpec("request",     "POST",   "-request",             "process_{s}_request", ["payload",       "user", "req"],  "request", False),
]


def _normalize_methods(methods: Optional[Sequence]) -> Optional[Set[str]]:
    """Resolve method names/groups/aliases to a canonical set. None → all enabled."""
    if methods is None:
        return None
    if isinstance(methods, str):
        expanded = _METHOD_GROUPS.get(methods)
        if expanded:
            return expanded
        return {_METHOD_ALIASES.get(methods, methods)}
    out: Set[str] = set()
    for m in methods:
        canonical = _METHOD_ALIASES.get(m, m)
        out |= _METHOD_GROUPS.get(canonical, {canonical})
    return out


def _record_id_param(path_vars: List[str]) -> str:
    """Return the first record-ID name not already used as a URL path variable."""
    for candidate in ("id", "record_id", "item_id", "pk"):
        if candidate not in path_vars:
            return candidate
    raise ValueError(f"All standard record-ID names are taken by path_vars={path_vars}")


def _build_handler(
    spec: RouteSpec,
    slug: str,
    svc_module: str,
    svc_resource: str,
    pk: str,
    model_cls: Type[BaseModel],
    role_dep: Any,
    path_vars: List[str],
    create_payload_is_list: bool,
) -> Callable:
    """
    Build a FastAPI-compatible handler for one route spec.

    URL path variables (from __url__: "/v2/{id}/items") are added to the
    handler's __signature__ so FastAPI discovers them; at runtime every service
    accesses them through request.path_params — the contract is consistent
    whether path_vars is empty or not.
    """
    svc_fn = spec.svc_fn.replace("{s}", svc_resource)

    def _invoke_args(kw: dict) -> list:
        out = []
        for arg in spec.svc_args:
            if arg is None:        out.append(None)
            elif arg == "{pk}":    out.append(kw[pk])
            elif arg == "item":    out.append(kw["item"])
            elif arg == "full_path": out.append(kw["full_path"])
            elif arg == "payload": out.append(kw["payload"])
            elif arg == "user":    out.append(kw.get("user"))
            elif arg == "req":     out.append(kw["request"])
        return out

    def handler(**kw):
        try:
            ret = safe_invoke(svc_module, svc_fn, _invoke_args(kw))
        except HTTPException:
            # FastAPI HTTPException is a control-flow signal — let it
            # propagate so the requested status code (e.g. 401 from an
            # authorization check) reaches the client instead of getting
            # wrapped into a generic 500.
            raise
        except Exception as exc:
            return _handle_exception(spec.key, slug, exc)

        normalized = _normalize_result(ret)

        if spec.res_model == "request":
            if isinstance(normalized, Response):
                return normalized
            if not isinstance(normalized, dict) or "metadata" not in normalized or "records" not in normalized:
                return JSONResponse(status_code=500, content=f"Invalid response from {svc_resource} service")
            return normalized

        if spec.check_404:
            if isinstance(normalized, Response):
                return normalized
            if not normalized:
                return JSONResponse(status_code=404, content="Item not found")

        return normalized

    # Synthetic __signature__: path vars → pk? → item? → full_path? → payload? → request → user(dep)?
    P = inspect.Parameter
    PK = inspect.Parameter.POSITIONAL_OR_KEYWORD
    params: List[inspect.Parameter] = [P(v, PK, annotation=str) for v in path_vars]
    if "{pk}"       in spec.svc_args: params.append(P(pk,          PK, annotation=str))
    item_annotation = List[model_cls] if create_payload_is_list and spec.key == "create" else model_cls
    if "item"       in spec.svc_args: params.append(P("item",      PK, annotation=item_annotation))
    if "full_path"  in spec.svc_args: params.append(P("full_path", PK, annotation=str))
    if "payload"    in spec.svc_args: params.append(P("payload",   PK, annotation=Dict[str, Any]))
    params.append(P("request", PK, annotation=Request))
    if role_dep is not None:
        params.append(P("user", PK, default=role_dep))
    handler.__signature__ = inspect.Signature(params)
    return handler


def _resolve_method_roles(
    spec_key: str,
    default_roles: Optional[Sequence[str]],
    method_roles: Optional[Dict[str, Optional[Sequence[str]]]],
) -> Optional[Sequence[str]]:
    """Return the effective roles for one route spec, considering method_roles overrides.

    method_roles keys may be canonical method names ('create', 'update', 'delete', ...)
    or group names ('writable', 'read_only', 'all').  The first matching key wins.
    A value of None means public (no auth); [] means any authenticated user.
    """
    if not method_roles:
        return default_roles
    # Check exact key first, then groups that contain this key
    if spec_key in method_roles:
        return method_roles[spec_key]
    for group_name, group_keys in _METHOD_GROUPS.items():
        if spec_key in group_keys and group_name in method_roles:
            return method_roles[group_name]
    return default_roles


# Canonical method keys (the union of every group) — used to tell a per-method
# openapi_extra mapping apart from a flat OpenAPI object.
_ALL_METHOD_KEYS: Set[str] = _METHOD_GROUPS["all"]


def _resolve_route_openapi_extra(spec_key: str, openapi_extra: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Return the openapi_extra object for one route.

    openapi_extra may be either:
      - a flat OpenAPI operation object (e.g. {'requestBody': ...}) applied to
        every POST route, the historical behavior; or
      - a per-method mapping keyed by canonical method names
        (e.g. {'create': {...}, 'request': {...}}) so each route can declare its
        own requestBody example/schema. Methods absent from the mapping get none.

    The two are distinguished unambiguously: OpenAPI operation fields
    (requestBody/responses/parameters/...) never collide with method names, so a
    mapping whose keys are all method names is treated as per-method.
    """
    if not openapi_extra:
        return None
    if all(key in _ALL_METHOD_KEYS for key in openapi_extra):
        return openapi_extra.get(spec_key)
    return openapi_extra


def create_crud_router(
    *,
    model_cls: Type[BaseModel],
    resource_slug: str,
    service_resource: str,
    service_module: str,
    roles: Optional[Sequence[str]],
    methods: Optional[Sequence] = None,
    path_vars: Optional[List[str]] = None,
    method_roles: Optional[Dict[str, Optional[Sequence[str]]]] = None,
    openapi_extra: Optional[Dict[str, Any]] = None,
    camel_case: bool = False,
    pascal_case: bool = False,
    list_at_root: bool = False,
    create_payload_is_list: bool = False,
) -> APIRouter:
    """
    Register the standard CloudSeeder CRUD + request routes for a model.

    methods — None (all), a group name ('read_only', 'writable'), or an explicit
              list of canonical keys: create | list | get | get_by_id | get_by_path
              | update | delete | request.  Old names (post, get_id, get_path, put)
              are accepted as aliases.

    path_vars — URL path variable names embedded in resource_slug
                (e.g. ['id'] for 'transfers/v2/{id}/deliveries').
                When set, the CRUD record-ID param is auto-renamed to avoid collision.
                Services access path vars via request.path_params.

    roles — None means the route is public (no authentication required).
            An empty list [] or '*' (coerced to [] by generator) allows any
            authenticated user regardless of role.

    method_roles — Optional per-method role overrides. Keys are method names or
                   group names ('writable', 'read_only'); values follow the same
                   semantics as roles. Overrides roles for matching methods only.
                   Example: {'writable': ['Admin'], 'list': []}

    openapi_extra — Optional raw OpenAPI object merged into the route spec.
                    Two forms are accepted:
                      * Flat — a single OpenAPI operation object applied to every
                        POST (create/request) route. Typical use: override the
                        requestBody example shown in Swagger UI.
                        Example: {'requestBody': {'content': {'application/json':
                            {'example': {'field': 'value'}}}}}
                      * Per-method — a mapping keyed by canonical method names so
                        each route gets its own object (e.g. distinct create vs
                        request requestBody examples). Methods absent from the
                        mapping get nothing.
                        Example: {'create': {'requestBody': {...}},
                                  'request': {'requestBody': {...}}}

    camel_case — When True the model is expected to have alias_generator=to_camel
                 and all routes are registered with response_model_by_alias=True so
                 GET responses are serialized with camelCase keys.  Use when the
                 external API contract requires camelCase (e.g. Dutchie POS).

    pascal_case — When True the model is expected to have alias_generator=to_pascal
                  and all routes are registered with response_model_by_alias=True so
                  GET responses are serialized with PascalCase keys.  Use when the
                  external API contract requires PascalCase (e.g. METRC).
                  Mutually exclusive with camel_case.

    list_at_root — When True the 'list' route is registered at the root slug with
                   no '-list' suffix (GET /resource instead of GET /resource-list),
                   and the singleton 'get' route is suppressed to avoid a path
                   collision.  Use when the external API returns a collection at
                   the bare resource URL.

    create_payload_is_list — When True the generated POST create route accepts
                   a JSON array of model objects instead of a single model.
    """
    router = APIRouter()
    active = _normalize_methods(methods)
    pv = list(path_vars or [])
    pk = _record_id_param(pv)

    if camel_case and pascal_case:
        raise ValueError("camel_case and pascal_case are mutually exclusive")

    # Detect whether the model serializes with aliases (camelCase or PascalCase
    # via alias_generator, or per-field aliases).
    _uses_aliases = camel_case or pascal_case or bool(
        getattr(model_cls.model_config, "alias_generator", None)
        or any(f.alias for f in model_cls.model_fields.values())
    )

    rm_item    = Union[model_cls, ServiceResponseMessage]
    rm_write   = Union[model_cls, ServiceResponseMessage, None]
    rm_list    = List[model_cls]
    rm_request = Union[RequestResponse, ServiceResponseMessage, None]
    response_models = {"item": rm_item, "write": rm_write, "list": rm_list, "request": rm_request}

    for spec in _ROUTES:
        if active is not None and spec.key not in active:
            continue

        # list_at_root: move 'list' to root suffix and suppress singleton 'get'
        if list_at_root and spec.key == "get":
            continue
        suffix = "" if (list_at_root and spec.key == "list") else spec.suffix

        effective_roles = _resolve_method_roles(spec.key, roles, method_roles)
        role_dep = None if effective_roles is None else Depends(auth_deps.require_role(list(effective_roles)))
        path = "/" + resource_slug + suffix.replace("{pk}", "{" + pk + "}")
        endpoint = _build_handler(spec, resource_slug, service_module, service_resource, pk, model_cls, role_dep, pv, create_payload_is_list)
        route_openapi_extra = _resolve_route_openapi_extra(spec.key, openapi_extra)
        router.add_api_route(
            path,
            endpoint,
            methods=[spec.http],
            response_model=response_models[spec.res_model],
            response_model_by_alias=_uses_aliases,
            openapi_extra=route_openapi_extra,
        )

    return router
