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
from robotlab_x.models.config import Config
from robotlab_x.service_response import info_message, error_message, warning_message
from pathlib import Path


logger = logging.getLogger(__name__)

# write - Create an item
def create_config(item: Config, user: dict, request: Request):
    logger.info("===============create_config called==============")

    item_id = item.id if hasattr(item, "id") and item.id else str(uuid.uuid4())
    logger.info(f"Using item_id: {item_id}")
    new_item = item.model_dump()
    new_item["id"] = item_id  # Store UUID in the database

    logger.info(item)

    db = get_database_client()
    if db:
        db.insert_item("config", item_id, new_item)

    logger.info(f"Config created: {new_item}")
    q = get_queue()
    if q:
        q.send_message(new_item)
        logger.info(f"Message sent to queue: Config created: {new_item}")
        logger.info(f"Queue message count: {q.get_message_count()}")
    return new_item

# read - get all items
def get_all_config(user: dict, request: Request):
    logger.info("===============get_all_config called==============")
    db = get_database_client()
    if db:
        return db.get_all_items("config")
    return []

# read - get an item
def get_config(id: str, user: dict, request: Request):
    logger.info("===============get_config called==============")
    logger.info(f"Received request to retrieve config with id: {id}")
    db = get_database_client()
    if db:
        item = db.get_item("config", id)
    return item

# read - get_path an item
def get_path_config(path: str, user: dict, request: Request):
    logger.info("===============get_config called==============")
    logger.info(f"Received request to retrieve {path} with path: {path}")
    db = get_database_client()
    if db:
        item = db.get_item("config", path)
    return item


# write - update an item (without modifying ID)
def update_config(id: str, new_item: Config, user: dict, request: Request):
    logger.info("===============update_config called==============")
    logger.info(new_item)
    db = get_database_client()
    if not db:
        return None
    # 404 explicitly when the row doesn't exist. Otherwise the route's
    # response_model serialization walks an empty {} (from a missing-row
    # update_item) back through the Pydantic model and returns a
    # default-populated dict to the caller — looks like a successful
    # upsert but nothing was actually written.
    if not db.get_item("config", id):
        return None
    # include_nulls=True so explicit clears (e.g. pid=None on stop) actually
    # persist instead of being silently filtered as a "partial update".
    db.update_item("config", id, new_item.model_dump(), include_nulls=True)
    return db.get_item("config", id)

# write - delete an item
def delete_config(id: str, user: dict, request: Request):
    logger.info("===============delete_config called==============")
    logger.info(f"Received request to delete config with id {id}")
    db = get_database_client()
    if db:
        item = db.get_item("config", id)
        if not item:
            logger.warning(f"Config with id {id} not found")
            return None
        db.delete_item("config", id)
    return item # necessary?

# process any type of request
def process_config_request(payload: Dict[str, Any], user: dict, request: Request):
    logger.info("===============process_config_request==============")

    config: Config = get_settings()
    logger.info(f"payload: {payload}")

    db = get_database_client()
    if db:
        records = db.query_items(table_name="config", criteria={})
        # do stuff
        return {"metadata": {"status": "success"}, "records": records}

