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
from robotlab_x.models.service_meta import ServiceMeta
from robotlab_x.service_response import info_message, error_message, warning_message
from pathlib import Path


logger = logging.getLogger(__name__)

# write - Create an item
def create_service_meta(item: ServiceMeta, user: dict, request: Request):
    logger.info("===============create_service_meta called==============")

    item_id = item.id if hasattr(item, "id") and item.id else str(uuid.uuid4())
    logger.info(f"Using item_id: {item_id}")
    new_item = item.model_dump()
    new_item["id"] = item_id  # Store UUID in the database

    logger.info(item)

    db = get_database_client()
    if db:
        db.insert_item("service_meta", item_id, new_item)

    logger.info(f"ServiceMeta created: {new_item}")
    q = get_queue()
    if q:
        q.send_message(new_item)
        logger.info(f"Message sent to queue: ServiceMeta created: {new_item}")
        logger.info(f"Queue message count: {q.get_message_count()}")
    return new_item

# read - get all items
def get_all_service_meta(user: dict, request: Request):
    logger.info("===============get_all_service_meta called==============")
    db = get_database_client()
    if db:
        return db.get_all_items("service_meta")
    return []

# read - get an item
def get_service_meta(id: str, user: dict, request: Request):
    logger.info("===============get_service_meta called==============")
    logger.info(f"Received request to retrieve service_meta with id: {id}")
    db = get_database_client()
    if db:
        item = db.get_item("service_meta", id)
    return item

# read - get_path an item
def get_path_service_meta(path: str, user: dict, request: Request):
    logger.info("===============get_service_meta called==============")
    logger.info(f"Received request to retrieve {path} with path: {path}")
    db = get_database_client()
    if db:
        item = db.get_item("service_meta", path)
    return item


# write - update an item (without modifying ID)
def update_service_meta(id: str, new_item: ServiceMeta, user: dict, request: Request):
    logger.info("===============update_service_meta called==============")
    logger.info(new_item)
    db = get_database_client()
    if not db:
        return None
    # 404 explicitly when the row doesn't exist. Otherwise the route's
    # response_model serialization walks an empty {} (from a missing-row
    # update_item) back through the Pydantic model and returns a
    # default-populated dict to the caller — looks like a successful
    # upsert but nothing was actually written.
    if not db.get_item("service_meta", id):
        return None
    # include_nulls=True so explicit clears (e.g. pid=None on stop) actually
    # persist instead of being silently filtered as a "partial update".
    db.update_item("service_meta", id, new_item.model_dump(), include_nulls=True)
    return db.get_item("service_meta", id)

# write - delete an item
def delete_service_meta(id: str, user: dict, request: Request):
    logger.info("===============delete_service_meta called==============")
    logger.info(f"Received request to delete service_meta with id {id}")
    db = get_database_client()
    if db:
        item = db.get_item("service_meta", id)
        if not item:
            logger.warning(f"ServiceMeta with id {id} not found")
            return None
        db.delete_item("service_meta", id)
    return item # necessary?

# process any type of request
def process_service_meta_request(payload: Dict[str, Any], user: dict, request: Request):
    logger.info("===============process_service_meta_request==============")

    config: Config = get_settings()
    logger.info(f"payload: {payload}")

    db = get_database_client()
    if db:
        records = db.query_items(table_name="service_meta", criteria={})
        # do stuff
        return {"metadata": {"status": "success"}, "records": records}

