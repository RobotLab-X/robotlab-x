import os
import json
import logging
import re
from typing import Dict, List, Any, Union
from pydantic import BaseModel

from .interface import DatabaseAdapter

logger = logging.getLogger(__name__)


from models.database_filesystem_config import DatabaseFilesystemConfig

class FilesystemDatabase(DatabaseAdapter):
    def __init__(self, config: DatabaseFilesystemConfig):
        """
        Initialize the FilesystemDatabase implementation with strongly typed DatabaseFilesystemConfig.
        """
        self.config = config
        self.base_dir = getattr(config, "database_dir", None)
        if self.base_dir is None:
            self.base_dir = os.path.join("data", "filesystem_db")
        if not os.path.exists(self.base_dir):
            os.makedirs(self.base_dir, exist_ok=True)
        logger.info(f"FilesystemDatabase initialized with base directory: {self.base_dir}")

    def _get_table_dir(self, table: str) -> str:
        """
        Get the directory path for a given table. Create the directory if it doesn't exist.
        """
        table_dir = os.path.join(self.base_dir, table)
        if not os.path.exists(table_dir):
            os.makedirs(table_dir, exist_ok=True)
        return table_dir

    def _get_file_path(self, table: str, key: str) -> str:
        """
        Construct the file path for a given table and key.
        """
        table_dir = self._get_table_dir(table)
        return os.path.join(table_dir, key) 
    
    def upsert_item(self, table: str, key: str, item: dict) -> dict:
        logger.debug(f"Upserting item into {table} with key {key}: {item}")
        # I believe file insert/upsert is the same
        return self.insert_item(table, key, item)

    def insert_item(self, table: str, key: str, item: dict) -> dict:
        """
        Insert an item into the specified table by writing it as a JSON file.
        The item is stored at: <base_dir>/<table>/<key>
        """
        logger.debug(f"Inserting item into table '{table}' with key '{key}': {item}")
        # item["id"] = key  # Ensure the key is included in the item.
        # Details on how to handle storage like identities "id" should not modify exising data
        file_path = self._get_file_path(table, key)
        try:
            # Ensure the parent directory exists
            os.makedirs(os.path.dirname(file_path), exist_ok=True)
            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(item, f)
            logger.info(f"Item inserted successfully at {file_path}")
        except Exception as e:
            logger.exception("Failed to insert item into filesystem")
            raise e
        return item

    def get_item(self, table: str, key: str) -> dict:
        """
        Retrieve an item by key from the specified table.
        
        Returns:
        - A dict if the file is recognized as JSON.
        - Raw bytes if the file is binary or not recognized as JSON.
        - An empty dict if the file does not exist.
        """
        logger.info(f"Retrieving item from table '{table}' with key: {key}")
        file_path = self._get_file_path(table, key)
        
        if not os.path.exists(file_path):
            logger.warning(f"Item with key '{key}' not found in table '{table}'.")
            return {}

        try:
            # Check the file extension to decide if it is JSON.
            # if file_path.lower().endswith(".json"):
                with open(file_path, "r", encoding="utf-8") as f:
                    item = json.load(f)
                logger.info(f"JSON item retrieved: {item}")
                return item
            # else:
            #     with open(file_path, "rb") as f:
            #         data = f.read()
            #     logger.info("Binary or non-JSON data retrieved.")
            #     return data

        except Exception as e:
            logger.exception("Error reading item from filesystem")
            raise e
        
    def get_binary_item(self, table: str, key: str) -> dict:
        """
        Retrieve an item by key from the specified table.
        
        Returns:
        - Raw bytes if the file is binary or not recognized as JSON.
        - An empty dict if the file does not exist.
        """
        logger.info(f"Retrieving binary item from table '{table}' with key: {key}")
        file_path = self._get_file_path(table, key)
        
        if not os.path.exists(file_path):
            logger.warning(f"Item with key '{key}' not found in table '{table}'.")
            return {}

        try:
            with open(file_path, "rb") as f:
                data = f.read()
            logger.info("Binary or non-JSON data retrieved.")
            return data

        except Exception as e:
            logger.exception("Error reading item from filesystem")
            raise e        

    def get_all_items(self, table: str) -> list:
        """
        Retrieve all items from the specified table.
        Scans the table directory for all JSON files and returns their contents.
        """
        logger.info(f"Retrieving all items from table '{table}'")
        table_dir = self._get_table_dir(table)
        items = []
        try:
            for filename in os.listdir(table_dir):
                # if filename.endswith(".json"):
                    file_path = os.path.join(table_dir, filename)
                    with open(file_path, "r", encoding="utf-8") as f:
                        item = json.load(f)
                        items.append(item)
            logger.info(f"Total items retrieved from '{table}': {len(items)}")
            return items
        except Exception as e:
            logger.exception("Error retrieving all items from filesystem")
            raise e

    def update_item(self, table: str, key: str, updates: dict, include_nulls: bool = False) -> dict:
        """
        Update an item in the specified table by merging the provided updates.
        Returns the updated item.
        """
        logger.info(f"Updating item in table '{table}' with key '{key}' using updates: {updates}")
        item = self.get_item(table, key)
        if not item:
            logger.warning(f"Item with key '{key}' not found in table '{table}', update skipped.")
            return {}
        filtered_updates = {k: v for k, v in updates.items() if k != "id"}
        if not include_nulls:
            filtered_updates = {k: v for k, v in filtered_updates.items() if v is not None}
        if not filtered_updates:
            logger.warning("update_item received no applicable updates after filtering")
            return item

        item.update(filtered_updates)
        file_path = self._get_file_path(table, key)
        try:
            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(item, f)
            logger.info(f"Item updated successfully: {item}")
        except Exception as e:
            logger.exception("Failed to update item in filesystem")
            raise e
        return item

    def delete_item(self, table: str, key: str) -> None:
        """
        Delete an item from the specified table by removing its JSON file.
        """
        logger.info(f"Deleting item from table '{table}' with key: {key}")
        file_path = self._get_file_path(table, key)
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
                logger.info(f"Item with key '{key}' deleted from table '{table}'")
            else:
                logger.warning(f"Item with key '{key}' not found in table '{table}', nothing to delete.")
        except Exception as e:
            logger.exception("Failed to delete item from filesystem")
            raise e

    def search_by_key_part(self, table: str, key_part: str, regex: bool = False) -> List[Dict[str, Any]]:
        """
        Search for items in the specified table whose keys contain or match a part of the given key.
        If regex is True, treats key_part as a regular expression; otherwise, does a prefix search.
        """
        logger.info(f"Searching in table '{table}' for keys matching: {key_part} (regex={regex})")
        items = self.get_all_items(table)
        if regex:
            pattern = re.compile(key_part)
            matching_items = [item for item in items if "id" in item and pattern.search(item["id"])]
        else:
            matching_items = [item for item in items if "id" in item and item["id"].startswith(key_part)]
        logger.info(f"Found {len(matching_items)} matching items in table '{table}'")
        return matching_items
    
    def query_items(self, table_name: str, criteria: dict) -> List[Dict[str, Any]]:
        """
        Query items in the specified table based on the provided criteria.
        
        Args:
        - table_name: The name of the table to query.
        - criteria: A dictionary where keys are field names and values are the expected values.
        
        Returns:
        - A list of items matching the criteria.
        """
        logger.info(f"Querying items in table '{table_name}' with criteria: {criteria}")
        items = self.get_all_items(table_name)
        matching_items = []

        for item in items:
            if all(item.get(key) == value for key, value in criteria.items()):
                matching_items.append(item)

        logger.info(f"Found {len(matching_items)} matching items in table '{table_name}'")
        return matching_items

    def copy_table(self, source_table: str, dest_table: str) -> None:
        """
        Copy all items from source_table to dest_table by copying all files in the source directory
        to the destination directory. Verifies that source_table is a directory.
        """
        import shutil
        source_dir = self._get_table_dir(source_table)
        dest_dir = self._get_table_dir(dest_table)
        if not os.path.isdir(source_dir):
            raise FileNotFoundError(f"Source table directory does not exist: {source_dir}")
        # if os.path.exists(dest_dir):
        #     raise FileExistsError(f"Destination table directory already exists: {dest_dir}")
        shutil.copytree(source_dir, dest_dir, dirs_exist_ok=True)
        logger.info(f"Copied table '{source_table}' to '{dest_table}' ({source_dir} -> {dest_dir})")

    def query(self, querystr: str) -> list:
        raise NotImplementedError("Arbitrary query strings are not supported for FilesystemDatabase. Use query_items or other methods.")

    def insert_columns(
        self,
        table: str,
        columns: List[str],
        values: List[Any],
        conflict_strategy: str = "IGNORE"
    ) -> None:
        """
        Insert a row with specified columns and values into the filesystem database.
        For filesystem, we create a file with a generated key and store the column-value pairs as JSON.
        
        :param table: Table name (directory) to insert into.
        :param columns: List of column names.
        :param values: List of values corresponding to the columns.
        :param conflict_strategy: Strategy for handling conflicts. Only "IGNORE" is supported.
        """
        import uuid
        import json
        
        if len(columns) != len(values):
            raise ValueError(f"Number of columns ({len(columns)}) must match number of values ({len(values)})")
        
        # Create a dictionary from columns and values
        item = dict(zip(columns, values))
        
        # Generate a unique key if not provided in columns
        if 'id' not in columns:
            key = str(uuid.uuid4())
            item['id'] = key
        else:
            key = str(item['id'])
        
        # Check for existing file if conflict_strategy is IGNORE
        file_path = self._get_file_path(table, key)
        if conflict_strategy == "IGNORE" and os.path.exists(file_path):
            logger.debug(f"File already exists for key {key}, ignoring insert")
            return
        elif conflict_strategy not in ["IGNORE", "REPLACE"]:
            logger.warning(f"Unsupported conflict strategy '{conflict_strategy}' for FilesystemDatabase, using IGNORE")
        
        try:
            # Insert the item
            self.insert_item(table, key, item)
            logger.debug(f"Inserted item with key {key} into table {table}")
        except Exception as e:
            logger.error(f"Failed to insert into {table}: {e}")
            raise

    def ensure_table(
        self,
        model: type[BaseModel],
        table_name: str = None
    ) -> None:
        """
        Ensure that a filesystem "table" (directory) exists for the given Pydantic model.
        Creates the table directory and optionally a metadata file.
        """
        if table_name is None:
            # Convert CamelCase to snake_case
            table_name = re.sub(r'(?<!^)(?=[A-Z])', '_', model.__name__).lower()
        
        try:
            # Create the table directory
            table_dir = self._get_table_dir(table_name)
            
            # Create a metadata file for the table
            metadata_path = os.path.join(table_dir, '.table_metadata.json')
            if not os.path.exists(metadata_path):
                metadata = {
                    "table_name": table_name,
                    "model": model.__name__,
                    "created_by": "ensure_table",
                    "fields": {}
                }
                
                # Add field information if available
                try:
                    fields = model.__fields__ if hasattr(model, '__fields__') else model.model_fields
                    for field_name, field_info in fields.items():
                        field_type = field_info.annotation if hasattr(field_info, 'annotation') else str(field_info)
                        metadata["fields"][field_name] = str(field_type)
                except Exception as e:
                    logger.warning(f"Could not extract field info for model {model.__name__}: {e}")
                
                with open(metadata_path, 'w') as f:
                    json.dump(metadata, f, indent=2)
                    
                logger.info(f"Created filesystem table '{table_name}' for model {model.__name__}")
            else:
                logger.debug(f"Filesystem table '{table_name}' already exists for model {model.__name__}")
                
        except Exception as e:
            logger.error(f"Error ensuring filesystem table for model {model.__name__}: {e}")
            raise
