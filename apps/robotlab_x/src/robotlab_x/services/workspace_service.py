# unmanaged
from fastapi import Request
import logging
from typing import List, Dict, Any
import uuid
from robotlab_x.models.config import Config
from config import get_settings
from queues.interface import QueueClient
from database.interface import DatabaseAdapter
from database.factory import get_database_client
from queues.factory import get_queue
from robotlab_x.models.workspace import Workspace
from robotlab_x.service_response import info_message, error_message, warning_message
from pathlib import Path


logger = logging.getLogger(__name__)

# write - Create an item
def create_workspace(item: Workspace, user: dict, request: Request):
    logger.info("===============create_workspace called==============")

    item_id = item.id if hasattr(item, "id") and item.id else str(uuid.uuid4())
    logger.info(f"Using item_id: {item_id}")
    new_item = item.model_dump()
    new_item["id"] = item_id  # Store UUID in the database

    logger.info(item)

    db = get_database_client()
    if db:
        db.insert_item("workspace", item_id, new_item)

    logger.info(f"Workspace created: {new_item}")
    q = get_queue()
    if q:
        q.send_message(new_item)
        logger.info(f"Message sent to queue: Workspace created: {new_item}")
        logger.info(f"Queue message count: {q.get_message_count()}")
    return new_item

# Statuses that keep a proxy visible on the always-live runtime canvas.
# The runtime canvas is where the operator drops service "blocks": a
# dropped placeholder — and every lifecycle state it then passes through
# (installing → installed → starting → running → stopping → stopped →
# error) — must persist on the canvas, not just running ones. Otherwise a
# block vanishes the moment it's dropped (placeholder), or when it's
# stopped. Only 'uninstalled' (the row is being deleted) drops out.
RUNTIME_CANVAS_STATES = {
    "placeholder", "installing", "installed",
    "starting", "running", "stopping", "stopped", "error",
}


def _hydrate_runtime_membership(db: DatabaseAdapter, row: Dict[str, Any]) -> Dict[str, Any]:
    """For kind='runtime' workspaces, compute service_proxy_ids from the
    registry. The runtime canvas is a live mirror of currently-running
    services — its membership is derived, not stored.
    """
    if not row or row.get("kind") != "runtime":
        return row
    proxies = db.get_all_items("service_proxy") or []
    row["service_proxy_ids"] = [
        p.get("id") for p in proxies
        if p.get("status") in RUNTIME_CANVAS_STATES and p.get("id")
    ]
    return row


# read - get all items
def get_all_workspace(user: dict, request: Request):
    logger.info("===============get_all_workspace called==============")
    db = get_database_client()
    if not db:
        return []
    rows = db.get_all_items("workspace") or []
    return [_hydrate_runtime_membership(db, r) for r in rows]

# read - get an item
def get_workspace(id: str, user: dict, request: Request):
    logger.info("===============get_workspace called==============")
    logger.info(f"Received request to retrieve workspace with id: {id}")
    db = get_database_client()
    if db:
        item = db.get_item("workspace", id)
        return _hydrate_runtime_membership(db, item) if item else item
    return None

# read - get_path an item
def get_path_workspace(path: str, user: dict, request: Request):
    logger.info("===============get_workspace called==============")
    logger.info(f"Received request to retrieve {path} with path: {path}")
    db = get_database_client()
    if db:
        item = db.get_item("workspace", path)
        return _hydrate_runtime_membership(db, item) if item else item
    return None


# write - update an item (without modifying ID)
def update_workspace(id: str, new_item: Workspace, user: dict, request: Request):
    logger.info("===============update_workspace called==============")
    logger.info(new_item)
    db = get_database_client()
    if not db:
        return None
    # 404 explicitly when the row doesn't exist. Otherwise the route's
    # response_model serialization walks an empty {} (from a missing-row
    # update_item) back through the Pydantic model and returns a
    # default-populated dict to the caller — looks like a successful
    # upsert but nothing was actually written.
    existing = db.get_item("workspace", id)
    if not existing:
        return None
    payload = new_item.model_dump()
    # Runtime workspace: layout + edges may be updated, but ``kind`` and
    # ``service_proxy_ids`` are managed by the runtime itself. Force them.
    if existing.get("kind") == "runtime":
        payload["kind"] = "runtime"
        payload["service_proxy_ids"] = None
    # include_nulls=True so explicit clears (e.g. pid=None on stop) actually
    # persist instead of being silently filtered as a "partial update".
    db.update_item("workspace", id, payload, include_nulls=True)
    item = db.get_item("workspace", id)
    return _hydrate_runtime_membership(db, item) if item else item

# write - delete an item
def delete_workspace(id: str, user: dict, request: Request):
    logger.info("===============delete_workspace called==============")
    logger.info(f"Received request to delete workspace with id {id}")
    db = get_database_client()
    if db:
        item = db.get_item("workspace", id)
        if not item:
            logger.warning(f"Workspace with id {id} not found")
            return None
        # The singleton runtime workspace is always available — refuse to
        # delete it. The UI shouldn't expose a delete affordance for it,
        # but this guard catches direct API hits too.
        if item.get("kind") == "runtime":
            logger.warning("Refusing to delete runtime workspace")
            return None
        db.delete_item("workspace", id)
    return item # necessary?

# process any type of request
def process_workspace_request(payload: Dict[str, Any], user: dict, request: Request):
    logger.info("===============process_workspace_request==============")

    config: Config = get_settings()
    logger.info(f"payload: {payload}")

    db = get_database_client()
    if db:
        records = db.query_items(table_name="workspace", criteria={})
        # do stuff
        return {"metadata": {"status": "success"}, "records": records}

