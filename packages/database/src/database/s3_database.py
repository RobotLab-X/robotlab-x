import json
import logging
import re
from typing import Dict, List, Any, Union
import boto3
from botocore.exceptions import ClientError
from pydantic import BaseModel

from .interface import DatabaseAdapter

logger = logging.getLogger(__name__)


from models.database_s3_config import DatabaseS3Config

class S3Database(DatabaseAdapter):
    def __init__(self, config: DatabaseS3Config):
        """
        Initialize the S3Database implementation with strongly typed DatabaseS3Config.
        """
        self.config = config
        if not config.bucket_name:
            raise ValueError("S3Database requires a 'bucket_name' in the config.")

        if config.aws_access_key_id and config.aws_secret_access_key:
            self.s3 = boto3.resource(
                "s3",
                region_name=config.region_name,
                aws_access_key_id=config.aws_access_key_id,
                aws_secret_access_key=config.aws_secret_access_key,
            )
        else:
            self.s3 = boto3.resource("s3", region_name=config.region_name) if config.region_name else boto3.resource("s3")

        self.bucket = self.s3.Bucket(config.bucket_name)
        logger.info(f"S3Database initialized with bucket: {config.bucket_name}")

    def _get_s3_key(self, table: str, key: str) -> str:
        """Construct the S3 object key for the given table and key."""
        return f"{table}/{key}"
    
    def upsert_item(self, table: str, key: str, item: dict) -> dict:
        logger.debug(f"Upserting item into {table} with key {key}: {item}")
        # I believe s3 insert/upsert is the same
        return self.insert_item(table, key, item)

    def insert_item(self, table: str, key: str, item: dict) -> dict:
        """Insert an item into the specified table (S3 prefix)."""
        logger.debug(f"Inserting item into table '{table}' with key '{key}': {item}")
        # Ensure the key is included in the item
        # item["id"] = key - bad idea
        s3_key = self._get_s3_key(table, key)
        item_json = json.dumps(item, indent=2)
        try:
            self.bucket.put_object(Key=s3_key, Body=item_json)
            logger.info(f"Item inserted successfully at S3 key: {s3_key}")
        except ClientError as e:
            logger.exception("Failed to insert item into S3")
            raise e
        return item

    def get_item(self, table: str, key: str) -> dict:
        """Retrieve an item by key from the specified table (S3 prefix)."""
        logger.info(f"Retrieving item from table '{table}' with key: {key}")
        s3_key = self._get_s3_key(table, key)
        try:
            obj = self.s3.Object(self.config.bucket_name, s3_key)
            response = obj.get()
            data = response["Body"].read().decode("utf-8")
            item = json.loads(data)
            logger.debug(f"Item retrieved: {item}")
            return item
        except ClientError as e:
            if e.response.get("Error", {}).get("Code") == "NoSuchKey":
                logger.warning(f"Item with key '{key}' not found in table '{table}'.")
                return {}
            else:
                logger.exception("Error retrieving item from S3")
                raise e
            
    def get_binary_item(self, table: str, key: str) -> bytes:
        s3_key = self._get_s3_key(table, key)
        logger.info(f"Retrieving binary item from bucket with key: {s3_key}")
        try:
            obj = self.s3.Object(self.config.bucket_name, s3_key)
            response = obj.get()

            body = response["Body"].read()

            logger.info("Binary or non-JSON data retrieved.")
            return body

        except ClientError as e:
            if e.response.get("Error", {}).get("Code") == "NoSuchKey":
                logger.warning(f"Item with key '{key}' not found in table '{table}'.")
                return {}
            else:
                logger.exception("Error retrieving item from S3")
                raise e            

    def get_all_items(self, table: str) -> list:
        """Retrieve all items from the specified table (S3 prefix)."""
        logger.info(f"Retrieving all items from table '{table}'")
        prefix = f"{table}/"
        items = []
        try:
            for obj_summary in self.bucket.objects.filter(Prefix=prefix):
                obj = self.s3.Object(self.config.bucket_name, obj_summary.key)
                response = obj.get()
                data = response["Body"].read().decode("utf-8")
                item = json.loads(data)
                items.append(item)
            logger.info(f"Total items retrieved from '{table}': {len(items)}")
            return items
        except ClientError as e:
            logger.exception("Error retrieving all items from S3")
            raise e

    def update_item(self, table: str, key: str, updates: dict, include_nulls: bool = False) -> dict:
        """
        Update an item in the specified table (S3 prefix) by merging the updates.
        If the item doesn't exist, a warning is logged.
        """
        logger.info(f"Updating item in table '{table}' with key '{key}' using updates: {updates}")
        existing_item = self.get_item(table, key)
        if not existing_item:
            logger.warning(f"Item with key '{key}' not found in table '{table}', update skipped.")
            return {}
        filtered_updates = {k: v for k, v in updates.items() if k != "id"}
        if not include_nulls:
            filtered_updates = {k: v for k, v in filtered_updates.items() if v is not None}
        if not filtered_updates:
            logger.warning("update_item received no applicable fields for S3 table %s", table)
            return existing_item
        existing_item.update(filtered_updates)
        s3_key = self._get_s3_key(table, key)
        try:
            self.bucket.put_object(Key=s3_key, Body=json.dumps(existing_item))
            logger.debug(f"Item updated successfully: {existing_item}")
        except ClientError as e:
            logger.exception("Failed to update item in S3")
            raise e
        return existing_item

    def delete_item(self, table: str, key: str) -> None:
        """Delete an item from the specified table (S3 prefix)."""
        logger.info(f"Deleting item from table '{table}' with key: {key}")
        s3_key = self._get_s3_key(table, key)
        try:
            obj = self.s3.Object(self.config.bucket_name, s3_key)
            obj.delete()
            logger.info(f"Item with key '{key}' deleted from table '{table}'")
        except ClientError as e:
            logger.exception("Failed to delete item from S3")
            raise e

    def search_by_key_part(self, table: str, key_part: str, regex: bool = False) -> List[Dict[str, Any]]:
        """
        Search for items in the specified table (S3 prefix) whose keys contain or match a part of the given key.
        
        :param table: The table (prefix) to search in.
        :param key_part: The key part to search for.
        :param regex: If True, treat key_part as a regular expression; otherwise, do a prefix match.
        :return: A list of matching items.
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

    def query_items(self, table: str, criteria: dict) -> list:
        """
        Query for items in the specified table (S3 prefix) that match the given criteria.

        :param table: The table (prefix) to search in.
        :param criteria: A dictionary with key-value pairs that items must match.
        :return: A list of items that satisfy all criteria.
        """
        logger.info(f"Querying items in table '{table}' with criteria: {criteria}")
        all_items = self.get_all_items(table)
        if not criteria:
            logger.info("No criteria provided, returning all items")
            return all_items

        def match_item(item: dict) -> bool:
            # For each key/value in criteria, ensure the item has the key
            # and its value exactly matches the criteria value.
            for key, expected_value in criteria.items():
                if key not in item or item[key] != expected_value:
                    return False
            return True

        filtered_items = [item for item in all_items if match_item(item)]
        logger.info(f"Found {len(filtered_items)} items in table '{table}' that match the criteria.")
        return filtered_items

    def copy_table(self, source_table: str, dest_table: str) -> None:
        """
        Efficiently copy all items from source_table to dest_table using S3's native copy_object,
        without downloading and re-uploading the data.
        """
        logger.info(f"Copying all items from '{source_table}' to '{dest_table}' using S3 native copy.")
        prefix = f"{source_table}/"
        for obj_summary in self.bucket.objects.filter(Prefix=prefix):
            source_key = obj_summary.key
            dest_key = f"{dest_table}/{source_key[len(prefix):]}"
            copy_source = {
                'Bucket': self.config.bucket_name,
                'Key': source_key
            }
            try:
                self.bucket.copy(copy_source, dest_key)
                logger.info(f"Copied S3 object from {source_key} to {dest_key}")
            except ClientError as e:
                logger.exception(f"Failed to copy S3 object from {source_key} to {dest_key}")
                raise e

    def query(self, querystr: str) -> list:
        raise NotImplementedError("Arbitrary query strings are not supported for S3Database. Use query_items or other methods.")

    def insert_columns(
        self,
        table: str,
        columns: List[str],
        values: List[Any],
        conflict_strategy: str = "IGNORE"
    ) -> None:
        """
        Insert a row with specified columns and values into S3 storage.
        Creates an S3 object with a generated or provided key and stores the column-value pairs as JSON.
        
        :param table: The table (S3 prefix) to insert into.
        :param columns: List of column names to insert.
        :param values: List of values corresponding to the columns.
        :param conflict_strategy: Strategy for handling conflicts. Only "IGNORE" is supported.
        """
        import uuid
        
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
        
        # Check for existing item if conflict_strategy is IGNORE
        if conflict_strategy == "IGNORE":
            try:
                existing_item = self.get_item(table, key)
                if existing_item:  # Item exists, ignore insert
                    logger.debug(f"Item with key {key} already exists in table {table}, ignoring insert")
                    return
            except ClientError:
                pass  # Item doesn't exist, proceed with insert
        elif conflict_strategy not in ["IGNORE", "REPLACE"]:
            logger.warning(f"Unsupported conflict strategy '{conflict_strategy}' for S3Database, using IGNORE")
        
        try:
            # Insert the item using existing insert_item method
            self.insert_item(table, key, item)
            logger.debug(f"Inserted item with key {key} into table {table}")
        except Exception as e:
            logger.error(f"Failed to insert into S3 table {table}: {e}")
            raise

    def ensure_table(
        self,
        model: type[BaseModel],
        table_name: str = None
    ) -> None:
        """
        Ensure that an S3 "table" (prefix) exists for the given Pydantic model.
        For S3, this is essentially a no-op since S3 creates prefixes automatically
        when objects are uploaded. We'll just log and optionally create a marker object.
        """
        if table_name is None:
            # Convert CamelCase to snake_case
            table_name = re.sub(r'(?<!^)(?=[A-Z])', '_', model.__name__).lower()
        
        try:
            # S3 doesn't have tables, but we can create a marker object to indicate the "table" exists
            marker_key = f"{table_name}/.table_marker"
            
            # Check if marker exists
            try:
                self.bucket.Object(marker_key).load()
                logger.debug(f"S3 table '{table_name}' already exists for model {model.__name__}")
            except ClientError as e:
                if e.response['Error']['Code'] == '404':
                    # Create marker object
                    marker_data = {
                        "table_name": table_name,
                        "model": model.__name__,
                        "created_by": "ensure_table",
                        "type": "table_marker"
                    }
                    self.bucket.put_object(
                        Key=marker_key,
                        Body=json.dumps(marker_data),
                        ContentType='application/json'
                    )
                    logger.info(f"Created S3 table marker for '{table_name}' (model {model.__name__})")
                else:
                    logger.error(f"Error checking S3 table marker: {e}")
                    raise
                
        except Exception as e:
            logger.error(f"Error ensuring S3 table for model {model.__name__}: {e}")
            # Don't raise - S3 tables are created automatically, this is just for bookkeeping
            logger.warning(f"Continuing without S3 table marker for {table_name}")
