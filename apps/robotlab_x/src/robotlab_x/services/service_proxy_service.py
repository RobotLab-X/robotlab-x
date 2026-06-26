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
from robotlab_x.models.service_proxy import ServiceProxy
from robotlab_x.service_response import info_message, error_message, warning_message
from pathlib import Path


logger = logging.getLogger(__name__)

# write - Create an item
def create_service_proxy(item: ServiceProxy, user: dict, request: Request):
    logger.info("===============create_service_proxy called==============")

    item_id = item.id if hasattr(item, "id") and item.id else str(uuid.uuid4())
    logger.info(f"Using item_id: {item_id}")
    new_item = item.model_dump()
    new_item["id"] = item_id  # Store UUID in the database

    logger.info(item)

    db = get_database_client()
    if db:
        db.insert_item("service_proxy", item_id, new_item)

    logger.info(f"ServiceProxy created: {new_item}")
    q = get_queue()
    if q:
        q.send_message(new_item)
        logger.info(f"Message sent to queue: ServiceProxy created: {new_item}")
        logger.info(f"Queue message count: {q.get_message_count()}")
    return new_item

# read - get all items
def get_all_service_proxy(user: dict, request: Request):
    logger.info("===============get_all_service_proxy called==============")
    db = get_database_client()
    if db:
        return db.get_all_items("service_proxy")
    return []

# read - get an item
def get_service_proxy(id: str, user: dict, request: Request):
    logger.info("===============get_service_proxy called==============")
    logger.info(f"Received request to retrieve service_proxy with id: {id}")
    db = get_database_client()
    if db:
        item = db.get_item("service_proxy", id)
    return item

# read - get_path an item
def get_path_service_proxy(path: str, user: dict, request: Request):
    logger.info("===============get_service_proxy called==============")
    logger.info(f"Received request to retrieve {path} with path: {path}")
    db = get_database_client()
    if db:
        item = db.get_item("service_proxy", path)
    return item


# write - update an item (without modifying ID)
def update_service_proxy(id: str, new_item: ServiceProxy, user: dict, request: Request):
    logger.info("===============update_service_proxy called==============")
    logger.info(new_item)
    db = get_database_client()
    if not db:
        return None
    # 404 explicitly when the row doesn't exist. Otherwise the route's
    # response_model serialization walks an empty {} (from a missing-row
    # update_item) back through the Pydantic model and returns a
    # default-populated dict to the caller — looks like a successful
    # upsert but nothing was actually written.
    if not db.get_item("service_proxy", id):
        return None
    # include_nulls=True so explicit clears (e.g. pid=None on stop) actually
    # persist instead of being silently filtered as a "partial update".
    db.update_item("service_proxy", id, new_item.model_dump(), include_nulls=True)
    return db.get_item("service_proxy", id)

# write - delete an item
def delete_service_proxy(id: str, user: dict, request: Request):
    logger.info("===============delete_service_proxy called==============")
    logger.info(f"Received request to delete service_proxy with id {id}")
    db = get_database_client()
    if db:
        item = db.get_item("service_proxy", id)
        if not item:
            logger.warning(f"ServiceProxy with id {id} not found")
            return None
        db.delete_item("service_proxy", id)
    return item # necessary?

# process any type of request
def process_service_proxy_request(payload: Dict[str, Any], user: dict, request: Request):
    logger.info("===============process_service_proxy_request==============")

    config: Config = get_settings()
    logger.info(f"payload: {payload}")

    db = get_database_client()
    if db:
        records = db.query_items(table_name="service_proxy", criteria={})
        # do stuff
        return {"metadata": {"status": "success"}, "records": records}

