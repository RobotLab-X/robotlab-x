# unmanaged
from fastapi import Request
import logging
from datetime import datetime, timezone
from typing import List, Dict, Any
import uuid
from robotlab_x.models.config import Config
from config import get_settings
from queues.interface import QueueClient
from database.interface import DatabaseAdapter
from database.factory import get_database_client
from queues.factory import get_queue
from robotlab_x.models.service_request import ServiceRequest
from robotlab_x.runtime import lifecycle
from robotlab_x.service_response import info_message, error_message, warning_message
from pathlib import Path


logger = logging.getLogger(__name__)

# write - Create an item
def create_service_request(item: ServiceRequest, user: dict, request: Request):
    """Persist a ServiceRequest and run the lifecycle pipeline.

    The route is sync (FastAPI threadpool). The lifecycle uses the bus's
    synchronous publish path so we don't need to bounce off an event loop.
    Phase 3 runs the pipeline inline — durations are sub-millisecond for
    the mocked install_steps. Phase 6 will move long-running work into
    a background task.
    """
    item_id = item.id if hasattr(item, "id") and item.id else str(uuid.uuid4())
    new_item = item.model_dump()
    new_item["id"] = item_id
    new_item["status"] = "pending"
    new_item["created_at"] = datetime.now(timezone.utc).isoformat()

    db = get_database_client()
    if db:
        db.insert_item("service_request", item_id, new_item)

    logger.info("service_request.created id=%s action=%s", item_id, new_item.get("action"))

    if db:
        # Dispatch to the state-machine. Returns the request row in its
        # terminal state (completed or failed); lifecycle.handle handles
        # its own try/except so we never leak exceptions back to the UI.
        new_item = lifecycle.handle(new_item)

    return new_item

# read - get all items
def get_all_service_request(user: dict, request: Request):
    logger.info("===============get_all_service_request called==============")
    db = get_database_client()
    if db:
        return db.get_all_items("service_request")
    return []

# read - get an item
def get_service_request(id: str, user: dict, request: Request):
    logger.info("===============get_service_request called==============")
    logger.info(f"Received request to retrieve service_request with id: {id}")
    db = get_database_client()
    if db:
        item = db.get_item("service_request", id)
    return item

# read - get_path an item
def get_path_service_request(path: str, user: dict, request: Request):
    logger.info("===============get_service_request called==============")
    logger.info(f"Received request to retrieve {path} with path: {path}")
    db = get_database_client()
    if db:
        item = db.get_item("service_request", path)
    return item


# write - update an item (without modifying ID)
def update_service_request(id: str, new_item: ServiceRequest, user: dict, request: Request):
    logger.info("===============update_service_request called==============")
    logger.info(new_item)
    db = get_database_client()
    if not db:
        return None
    # 404 explicitly when the row doesn't exist. Otherwise the route's
    # response_model serialization walks an empty {} (from a missing-row
    # update_item) back through the Pydantic model and returns a
    # default-populated dict to the caller — looks like a successful
    # upsert but nothing was actually written.
    if not db.get_item("service_request", id):
        return None
    # include_nulls=True so explicit clears (e.g. pid=None on stop) actually
    # persist instead of being silently filtered as a "partial update".
    db.update_item("service_request", id, new_item.model_dump(), include_nulls=True)
    return db.get_item("service_request", id)

# write - delete an item
def delete_service_request(id: str, user: dict, request: Request):
    logger.info("===============delete_service_request called==============")
    logger.info(f"Received request to delete service_request with id {id}")
    db = get_database_client()
    if db:
        item = db.get_item("service_request", id)
        if not item:
            logger.warning(f"ServiceRequest with id {id} not found")
            return None
        db.delete_item("service_request", id)
    return item # necessary?

# process any type of request
def process_service_request_request(payload: Dict[str, Any], user: dict, request: Request):
    logger.info("===============process_service_request_request==============")

    config: Config = get_settings()
    logger.info(f"payload: {payload}")

    db = get_database_client()
    if db:
        records = db.query_items(table_name="service_request", criteria={})
        # do stuff
        return {"metadata": {"status": "success"}, "records": records}

