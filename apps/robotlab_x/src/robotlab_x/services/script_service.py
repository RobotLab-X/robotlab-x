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
from robotlab_x.models.script import Script
from robotlab_x.service_response import info_message, error_message, warning_message
from pathlib import Path


logger = logging.getLogger(__name__)

# write - Create an item
def create_script(item: Script, user: dict, request: Request):
    logger.info("===============create_script called==============")

    item_id = item.id if hasattr(item, "id") and item.id else str(uuid.uuid4())
    logger.info(f"Using item_id: {item_id}")
    new_item = item.model_dump()
    new_item["id"] = item_id  # Store UUID in the database

    logger.info(item)

    db = get_database_client()
    if db:
        db.insert_item("script", item_id, new_item)

    logger.info(f"Script created: {new_item}")
    q = get_queue()
    if q:
        q.send_message(new_item)
        logger.info(f"Message sent to queue: Script created: {new_item}")
        logger.info(f"Queue message count: {q.get_message_count()}")
    return new_item

# read - get all items
def get_all_script(user: dict, request: Request):
    logger.info("===============get_all_script called==============")
    db = get_database_client()
    if db:
        return db.get_all_items("script")
    return []

# read - get an item
def get_script(id: str, user: dict, request: Request):
    logger.info("===============get_script called==============")
    logger.info(f"Received request to retrieve script with id: {id}")
    db = get_database_client()
    if db:
        item = db.get_item("script", id)
    return item

# read - get_path an item
def get_path_script(path: str, user: dict, request: Request):
    logger.info("===============get_script called==============")
    logger.info(f"Received request to retrieve {path} with path: {path}")
    db = get_database_client()
    if db:
        item = db.get_item("script", path)
    return item


# write - update an item (without modifying ID)
def update_script(id: str, new_item: Script, user: dict, request: Request):
    logger.info("===============update_script called==============")
    logger.info(new_item)
    db = get_database_client()
    if not db:
        return None
    # 404 explicitly when the row doesn't exist. Otherwise the route's
    # response_model serialization walks an empty {} (from a missing-row
    # update_item) back through the Pydantic model and returns a
    # default-populated dict to the caller — looks like a successful
    # upsert but nothing was actually written.
    if not db.get_item("script", id):
        return None
    # include_nulls=True so explicit clears (e.g. pid=None on stop) actually
    # persist instead of being silently filtered as a "partial update".
    db.update_item("script", id, new_item.model_dump(), include_nulls=True)
    return db.get_item("script", id)

# write - delete an item
def delete_script(id: str, user: dict, request: Request):
    logger.info("===============delete_script called==============")
    logger.info(f"Received request to delete script with id {id}")
    db = get_database_client()
    if db:
        item = db.get_item("script", id)
        if not item:
            logger.warning(f"Script with id {id} not found")
            return None
        db.delete_item("script", id)
    return item # necessary?

# process any type of request — action dispatch over the script resource.
def process_script_request(payload: Dict[str, Any], user: dict, request: Request):
    """POST /v1/script-request {action, ...}.

    action="run" executes a saved script in the background — this was the
    bespoke ``POST /v1/script/{id}/run`` escape-hatch route, now folded
    into the standard request/action endpoint of the script model.
    Returns {"metadata": {...}, "records": []}; the run streams output on
    the bus topic carried back in metadata."""
    from fastapi import HTTPException
    from robotlab_x.runtime import script_runner

    action = (payload or {}).get("action")
    db = get_database_client()

    if action == "run":
        script_id = (payload or {}).get("id") or (payload or {}).get("script_id")
        if not script_id:
            raise HTTPException(400, "run requires 'id' (the script id)")
        script = db.get_item("script", script_id) if db else None
        if not script:
            raise HTTPException(404, "script not found")
        body = script.get("body") or ""
        language = script.get("language") or "python"
        try:
            run_id = script_runner.run_in_background(script_id, body, language=language)
        except ValueError as exc:
            raise HTTPException(400, str(exc))
        return {"metadata": {"status": "success", "action": "run", "script_id": script_id,
                             "run_id": run_id, "output_topic": f"/script/{script_id}/output"},
                "records": []}

    raise HTTPException(400, f"unknown action {action!r} (expected 'run')")

