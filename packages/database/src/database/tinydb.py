from typing import List, Dict, Any
import logging
from tinydb import TinyDB, Query
from tinydb.storages import JSONStorage
from tinydb.middlewares import CachingMiddleware
from tinydb.table import Document, Table as TinyDBTable
from models.database_tinydb_config import DatabaseTinydbConfig
from .interface import DatabaseAdapter
import os
import re
import json
from pydantic import BaseModel

logger = logging.getLogger(__name__)

class CustomTable(TinyDBTable):
    document_id_class = str  # Enforce string-based doc_id

class CustomDB(TinyDB):
    table_class = CustomTable  # Use CustomTable with string-based doc_id


class TinyDBDatabase(DatabaseAdapter):
    def __init__(self, config: DatabaseTinydbConfig):
        self.config = config
        self.base_dir = config.data_dir
        os.makedirs(self.base_dir, exist_ok=True)
        logger.debug(f"TinyDB base directory set to: {self.base_dir}")

    def _get_db(self, table: str) -> CustomDB:
        file_path = os.path.join(self.base_dir, f"{table}.json")
        # return CustomDB(file_path, storage=CachingMiddleware(JSONStorage))
        return CustomDB(file_path)
    
    def upsert_item(self, table: str, key: str, item: dict) -> dict:
        logger.debug(f"Upserting item into {table} with key {key}: {item}")
        item_exists = self.get_item(table, key)
        if item_exists:
            return self.update_item(table, key, item)
            # return item
        else:
            return self.insert_item(table, key, item)

    def insert_item(self, table: str, key: str, item: dict) -> dict:
        logger.debug(f"Inserting item into {table} with key {key}: {item}")
        db = self._get_db(table)
        # TinyDB's db.insert(Document(doc_id=...)) silently overwrites
        # an existing row with the same doc_id. Refuse the duplicate
        # explicitly so callers can't accidentally clobber state on a
        # race or a stale precondition.
        if db.contains(doc_id=key):
            raise ValueError(
                f"insert_item: '{key}' already exists in table '{table}'"
            )
        item["id"] = key  # Ensure the key is included in the item
        inserted_id = db.insert(Document(item, doc_id=key))  # Use key directly as doc_id
        logger.debug(f"Item inserted successfully with doc_id={inserted_id}: {item}")
        return item

    def get_item(self, table: str, key: str) -> dict:
        logger.debug(f"Retrieving item from {table} with id: {key}")
        db = self._get_db(table)
        result = db.get(doc_id=key)  # Use string-based doc_id
        if result:
            logger.debug(f"Item retrieved: {result}")
        else:
            logger.warning(f"Item with id {key} not found in {table}")
        return result if result else {}

    def get_all_items(self, table: str) -> list:
        logger.debug(f"Retrieving all items from {table}")
        db = self._get_db(table)
        items = db.all()
        logger.debug(f"Total items retrieved from {table}: {len(items)}")
        return items

    def update_item(self, table: str, key: str, updates: dict, include_nulls: bool = False) -> dict:
        logger.info(f"Updating item in {table} with id {key}: {updates}")
        db = self._get_db(table)
        existing_item = self.get_item(table, key)
        if existing_item:
            filtered_updates = {k: v for k, v in updates.items() if k != "id"}
            if not include_nulls:
                filtered_updates = {k: v for k, v in filtered_updates.items() if v is not None}
            if not filtered_updates:
                logger.warning("update_item called with no applicable fields for TinyDB table %s", table)
                return existing_item
            existing_item.update(filtered_updates)
            db.update(existing_item, doc_ids=[key])  # Use string-based doc_id
            logger.debug(f"Item updated successfully: {existing_item}")
        else:
            logger.warning(f"Item with id {key} not found in {table}, update skipped")
        return self.get_item(table, key)

    def delete_item(self, table: str, key: str) -> None:
        db = self._get_db(table)
        try:
            db.remove(doc_ids=[key])  # Use string-based doc_id
        except KeyError:
            pass  # Ignore if key does not exist

    def search_by_key_part(self, table: str, key_part: str, regex: bool = False) -> List[Dict[str, Any]]:
        """
        Search for items whose keys contain or match a part of the given key.

        :param table: The table to search in.
        :param key_part: The key part to search for.
        :param regex: Whether to treat key_part as a regular expression. Defaults to False (prefix search).
        :return: A list of matching items.
        """
        logger.debug(f"Searching in {table} for keys matching: {key_part} (regex={regex})")
        db = self._get_db(table)
        items = db.all()

        if regex:
            # Perform a regex search on the "id" field
            pattern = re.compile(key_part)
            matching_items = [item for item in items if "id" in item and pattern.search(item["id"])]
        else:
            # Default to a prefix match
            matching_items = [item for item in items if "id" in item and item["id"].startswith(key_part)]

        logger.debug(f"Found {len(matching_items)} matching items in {table}")
        return matching_items
    
    def query_items(self, table_name: str, criteria: dict):
        table = self._get_db(table_name)
        if not criteria:
            return table.all()

        q = Query()
        condition = None
        for key, value in criteria.items():
            expr = getattr(q, key) == value
            condition = expr if condition is None else condition & expr

        return table.search(condition)
    
    def get_binary_item(self, table_name: str, key: str) -> bytes:
        table = self._get_db(table_name)
        item = table.get(doc_id=key)
        if item:
            return json.dumps(item).encode()
        else:
            raise ValueError(f"Item with key {key} not found in {table_name}")

    def copy_table(self, source_table: str, dest_table: str) -> None:
        source_db = self._get_db(source_table)
        dest_db = self._get_db(dest_table)
        for item in source_db.all():
            key = item.get("id") or item.get("uuid")
            if key is not None:
                dest_db.insert(Document(item, doc_id=key))

    def query(self, querystr: str) -> list:
        raise NotImplementedError("Arbitrary query strings are not supported for TinyDBDatabase. Use query_items or other methods.")
    
    def insert_columns(
        self,
        table: str,
        columns: List[str],
        values: List[Any],
        conflict_strategy: str = "IGNORE"
    ) -> None:
        """
        Insert a new row into the table with specified columns and values.
        For TinyDB, this just inserts a dict with the given columns and values.
        The conflict_strategy parameter is ignored.
        """
        if len(columns) != len(values):
            raise ValueError(f"Number of columns ({len(columns)}) must match number of values ({len(values)})")
        db = self._get_db(table)
        item = dict(zip(columns, values))
        db.insert(item)
        logger.debug(f"Inserted row into {table} with columns {columns}")
    
    def ensure_table(
        self,
        model: type[BaseModel],
        table_name: str = None
    ) -> None:
        """
        Ensure that a table exists for the given Pydantic model.
        For TinyDB, tables are created automatically when accessed, so this is a no-op.
        """
        if table_name is None:
            # Convert CamelCase to snake_case
            table_name = re.sub(r'(?<!^)(?=[A-Z])', '_', model.__name__).lower()
        
        # TinyDB creates tables automatically when they are accessed
        # Just accessing the database file will ensure it exists
        db = self._get_db(table_name)
        logger.debug(f"Ensured table exists for model {model.__name__} as table '{table_name}'")

    def list_tables(self) -> List[str]:
        if not os.path.isdir(self.base_dir):
            return []
        names: List[str] = []
        for entry in os.listdir(self.base_dir):
            if not entry.endswith(".json"):
                continue
            full = os.path.join(self.base_dir, entry)
            if not os.path.isfile(full):
                continue
            names.append(entry[: -len(".json")])
        return sorted(names)
