from typing import Dict, Optional, List, Any
import boto3
import logging
from botocore.exceptions import BotoCoreError, ClientError
from boto3.dynamodb.types import TypeSerializer
from database.interface import DatabaseAdapter
import time
from pydantic import BaseModel, Field
import re

logger = logging.getLogger(__name__)
from models.database_dynamodb_config import DatabaseDynamodbConfig

class DynamoDBDatabase(DatabaseAdapter):
    """Implementation of DatabaseAdapter using AWS DynamoDB."""

    def __init__(self, config: DatabaseDynamodbConfig):
        """Initialize DynamoDB client with strongly typed DatabaseDynamodbConfig."""
        if not config:
            raise ValueError("Missing configuration for DynamoDB database.")
        self.config = config
        self.dynamodb = boto3.resource(
            "dynamodb",
            region_name=config.region_name,
            aws_access_key_id=config.aws_access_key_id,
            aws_secret_access_key=config.aws_secret_access_key
        )
        self.table_prefix = config.table_prefix
        self.serializer = TypeSerializer()

        
    def _get_table(self, table: str):
        """Helper function to get a DynamoDB table."""
        return self.dynamodb.Table(f"{self.table_prefix}{table}")

    def _serialize_item(self, item: dict) -> dict:
        """
        Convert Pydantic model (or dict) into DynamoDB's expected format using TypeSerializer.
        """
        serialized_item = {}
        for k, v in item.items():
            if k == "id":  # Ensure id is always a string
                serialized_item[k] = self.serializer.serialize(str(v))  # Convert id explicitly to str
            else:
                serialized_item[k] = self.serializer.serialize(v)
        return serialized_item
    
    def upsert_item(self, table: str, key: str, item: BaseModel) -> dict:
        """Insert a Pydantic model into DynamoDB using TypeSerializer."""
        self.insert_item(table, key, item)

    def insert_item(self, table: str, key: str, item: BaseModel) -> dict:
        """Insert a Pydantic model into DynamoDB using TypeSerializer."""
        try:

            print(f"Inserting key {key} item: {item}")

            table_ref = self._get_table(table)

            if isinstance(item, BaseModel):
                item = item.dict()  # Convert Pydantic model to dict

            item["id"] = str(key)  # Ensure 'id' is explicitly a string

            # serialized_item = self._serialize_item(item)  # Convert to DynamoDB format
            serialized_item = item 

            print(f"Serialized item: {serialized_item}")
            table_ref.put_item(Item=serialized_item)
            return item
        except (BotoCoreError, ClientError) as e:
            raise RuntimeError(f"DynamoDB insert failed: {e}")
        

    def get_item(self, table: str, key: str) -> dict:
        """Retrieve an item by key from DynamoDB."""
        print(f"Retrieving item with key {key} from table {table}")
        try:
            table_ref = self._get_table(table)
            response = table_ref.get_item(Key={"id": key})
            return response.get("Item", {})
        except (BotoCoreError, ClientError) as e:
            raise RuntimeError(f"DynamoDB get failed: {e}")

    def get_all_items(self, table: str) -> list:
        """Retrieve all items from a DynamoDB table (scan operation)."""
        try:
            table_ref = self._get_table(table)
            response = table_ref.scan()
            return response.get("Items", [])
        except (BotoCoreError, ClientError) as e:
            raise RuntimeError(f"DynamoDB scan failed: {e}")

    def update_item(self, table: str, key: str, updates: dict, include_nulls: bool = False) -> dict:
        """Update an item in DynamoDB."""
        try:
            table_ref = self._get_table(table)

            # Remove 'id' from updates to prevent modification errors
            updates = {k: v for k, v in updates.items() if k != "id"}
            if not include_nulls:
                updates = {k: v for k, v in updates.items() if v is not None}

            if not updates:
                logger.warning("update_item called with no applicable fields for DynamoDB table %s", table)
                return {}

            # Convert updates dictionary into an update expression
            update_expression = "SET " + ", ".join(f"#{k} = :{k}" for k in updates.keys())
            expression_attr_values = {f":{k}": v for k, v in updates.items()}
            expression_attr_names = {f"#{k}": k for k in updates.keys()}

            response = table_ref.update_item(
                Key={"id": key},  # Ensure 'id' is used only for lookup
                UpdateExpression=update_expression,
                ExpressionAttributeValues=expression_attr_values,
                ExpressionAttributeNames=expression_attr_names,
                ReturnValues="ALL_NEW",
            )
            return response.get("Attributes", {})
        except (BotoCoreError, ClientError) as e:
            raise RuntimeError(f"DynamoDB update failed: {e}")

    def delete_item(self, table: str, key: str) -> None:
        """Delete an item from DynamoDB."""
        try:
            table_ref = self._get_table(table)
            table_ref.delete_item(Key={"id": key})
        except (BotoCoreError, ClientError) as e:
            raise RuntimeError(f"DynamoDB delete failed: {e}")

    def query_items(self, table: str, criteria: dict) -> list:
        """
        Query for items in the specified DynamoDB table that match the given criteria.
        
        This method scans the table using a filter expression built from the criteria.
        If no criteria are provided, it returns all items.
        
        :param table: The DynamoDB table name (without the table_prefix, which is added automatically).
        :param criteria: A dictionary of key-value pairs that each item must match.
        :return: A list of items that satisfy the criteria.
        """
        try:
            table_ref = self._get_table(table)
            
            # If there are no criteria, return all items.
            if not criteria:
                return self.get_all_items(table)
            
            # Build the filter expression using boto3's Attr helper.
            from boto3.dynamodb.conditions import Attr
            filter_expr = None
            for key, value in criteria.items():
                condition = Attr(key).eq(value)
                filter_expr = condition if filter_expr is None else filter_expr & condition
            
            # Use scan with the constructed filter expression.
            response = table_ref.scan(FilterExpression=filter_expr)
            return response.get("Items", [])
        except (BotoCoreError, ClientError) as e:
            raise RuntimeError(f"DynamoDB query_items failed: {e}")

    def copy_table(self, source_table: str, dest_table: str) -> None:
        """
        Copy all items from source_table to dest_table.
        """
        items = self.get_all_items(source_table)
        for item in items:
            key = item.get("id") or item.get("uuid")
            if key is not None:
                self.insert_item(dest_table, key, item)

    def query(self, querystr: str) -> list:
        raise NotImplementedError("Arbitrary query strings are not supported for DynamoDBDatabase. Use query_items or other methods.")

    def insert_columns(
        self,
        table: str,
        columns: List[str],
        values: List[Any],
        conflict_strategy: str = "IGNORE"
    ) -> None:
        """
        Insert a row with specified columns and values into DynamoDB.
        
        :param table: Table name to insert into.
        :param columns: List of column names.
        :param values: List of values corresponding to the columns.
        :param conflict_strategy: Strategy for handling conflicts. Only "IGNORE" is supported.
        """
        import uuid
        from boto3.dynamodb.conditions import Key
        
        if len(columns) != len(values):
            raise ValueError(f"Number of columns ({len(columns)}) must match number of values ({len(values)})")
        
        # Create a dictionary from columns and values
        item = dict(zip(columns, values))
        
        # Ensure we have an id field for DynamoDB
        if 'id' not in columns:
            key = str(uuid.uuid4())
            item['id'] = key
        else:
            key = str(item['id'])
        
        try:
            table_ref = self._get_table(table)
            
            # Check for existing item if conflict_strategy is IGNORE
            if conflict_strategy == "IGNORE":
                try:
                    response = table_ref.get_item(Key={'id': key})
                    if 'Item' in response:
                        logger.debug(f"Item with key {key} already exists in table {table}, ignoring insert")
                        return  # Item exists, ignore insert
                except (BotoCoreError, ClientError):
                    pass  # Item doesn't exist, proceed with insert
            elif conflict_strategy not in ["IGNORE", "REPLACE"]:
                logger.warning(f"Unsupported conflict strategy '{conflict_strategy}' for DynamoDBDatabase, using IGNORE")
            
            # Serialize and insert the item
            serialized_item = self._serialize_item(item)
            table_ref.put_item(Item=serialized_item)
            logger.debug(f"Inserted item with key {key} into table {table}")
            
        except (BotoCoreError, ClientError) as e:
            logger.error(f"DynamoDB insert_columns failed for table {table}: {e}")
            raise RuntimeError(f"DynamoDB insert_columns failed: {e}")

    def ensure_table(
        self,
        model: type[BaseModel],
        table_name: str = None
    ) -> None:
        """
        Ensure that a DynamoDB table exists for the given Pydantic model.
        Creates the table if it doesn't exist.
        """
        if table_name is None:
            # Convert CamelCase to snake_case
            table_name = re.sub(r'(?<!^)(?=[A-Z])', '_', model.__name__).lower()
        
        full_table_name = f"{self.table_prefix}{table_name}"
        
        try:
            # Check if table exists
            table_ref = self.dynamodb.Table(full_table_name)
            table_ref.load()  # This will raise an exception if table doesn't exist
            logger.debug(f"Table '{full_table_name}' already exists for model {model.__name__}")
            
        except ClientError as e:
            if e.response['Error']['Code'] == 'ResourceNotFoundException':
                # Table doesn't exist, create it
                try:
                    logger.info(f"Creating DynamoDB table '{full_table_name}' for model {model.__name__}")
                    table = self.dynamodb.create_table(
                        TableName=full_table_name,
                        KeySchema=[
                            {
                                'AttributeName': 'id',
                                'KeyType': 'HASH'  # Partition key
                            }
                        ],
                        AttributeDefinitions=[
                            {
                                'AttributeName': 'id',
                                'AttributeType': 'S'  # String
                            }
                        ],
                        BillingMode='PAY_PER_REQUEST'  # On-demand billing
                    )
                    
                    # Wait for table to be created
                    table.wait_until_exists()
                    logger.info(f"Successfully created table '{full_table_name}' for model {model.__name__}")
                    
                except ClientError as create_error:
                    logger.error(f"Failed to create table '{full_table_name}': {create_error}")
                    raise RuntimeError(f"Failed to create DynamoDB table: {create_error}")
            else:
                logger.error(f"Error checking table existence: {e}")
                raise RuntimeError(f"Error ensuring DynamoDB table: {e}")
        except Exception as e:
            logger.error(f"Unexpected error ensuring table for model {model.__name__}: {e}")
            raise
