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
from robotlab_x.models.registration import Registration
from robotlab_x.service_response import info_message, error_message, warning_message
from pathlib import Path


logger = logging.getLogger(__name__)

# write - Create an item
def create_registration(item: Registration, user: dict, request: Request):
    logger.info("===============create_registration called==============")

    item_id = item.id if hasattr(item, "id") and item.id else str(uuid.uuid4())
    logger.info(f"Using item_id: {item_id}")
    new_item = item.model_dump()
    new_item["id"] = item_id  # Store UUID in the database

    logger.info(item)

    db = get_database_client()
    if db:
        db.insert_item("registration", item_id, new_item)

    logger.info(f"Registration created: {new_item}")
    q = get_queue()
    if q:
        q.send_message(new_item)
        logger.info(f"Message sent to queue: Registration created: {new_item}")
        logger.info(f"Queue message count: {q.get_message_count()}")
    return new_item

# read - get all items
def get_all_registration(user: dict, request: Request):
    logger.info("===============get_all_registration called==============")
    db = get_database_client()
    if db:
        return db.get_all_items("registration")
    return []

# read - get an item
def get_registration(id: str, user: dict, request: Request):
    logger.info("===============get_registration called==============")
    logger.info(f"Received request to retrieve registration with id: {id}")
    db = get_database_client()
    if db:
        item = db.get_item("registration", id)
    return item

# read - get_path an item
def get_path_registration(path: str, user: dict, request: Request):
    logger.info("===============get_registration called==============")
    logger.info(f"Received request to retrieve {path} with path: {path}")
    db = get_database_client()
    if db:
        item = db.get_item("registration", path)
    return item


# write - update an item (without modifying ID)
def update_registration(id: str, new_item: Registration, user: dict, request: Request):
    logger.info("===============update_registration called==============")
    logger.info(new_item)
    db = get_database_client()
    if not db:
        return None
    # 404 explicitly when the row doesn't exist. Otherwise the route's
    # response_model serialization walks an empty {} (from a missing-row
    # update_item) back through the Pydantic model and returns a
    # default-populated dict to the caller — looks like a successful
    # upsert but nothing was actually written.
    if not db.get_item("registration", id):
        return None
    # include_nulls=True so explicit clears (e.g. pid=None on stop) actually
    # persist instead of being silently filtered as a "partial update".
    db.update_item("registration", id, new_item.model_dump(), include_nulls=True)
    return db.get_item("registration", id)

# write - delete an item
def delete_registration(id: str, user: dict, request: Request):
    logger.info("===============delete_registration called==============")
    logger.info(f"Received request to delete registration with id {id}")
    db = get_database_client()
    if db:
        item = db.get_item("registration", id)
        if not item:
            logger.warning(f"Registration with id {id} not found")
            return None
        db.delete_item("registration", id)
    return item # necessary?

# process any type of request
def process_registration_request(payload: Dict[str, Any], user: dict, request: Request):
    logger.info("===============process_registration_request==============")

    config: Config = get_settings()
    logger.info(f"payload: {payload}")

    db = get_database_client()
    if db:
        records = db.query_items(table_name="registration", criteria={})
        # do stuff
        return {"metadata": {"status": "success"}, "records": records}

