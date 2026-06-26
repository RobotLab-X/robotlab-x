import logging
from typing import List, Dict, Any, Union, Optional
from pymongo import MongoClient
from pymongo.database import Database
from pymongo.collection import Collection
from pymongo.errors import PyMongoError
from bson import ObjectId
import json
import re
from .interface import DatabaseAdapter
from pydantic import BaseModel

logger = logging.getLogger(__name__)

from models.database_mongodb_config import DatabaseMongodbConfig

class MongoDBDatabase(DatabaseAdapter):
    """
    MongoDB database adapter with read replica support.
    Supports both primary (write) and replica (read) connections.
    """

    def __init__(self, config: DatabaseMongodbConfig):
        """Initialize MongoDB connection with strongly typed DatabaseMongodbConfig."""
        if not config:
            raise ValueError("Missing configuration for MongoDB database.")
        self.config = config
        self.replica_client = MongoClient(
            config.mongodb_replica_uri,
            maxPoolSize=config.mongodb_max_pool_size,
            minPoolSize=config.mongodb_min_pool_size
        )
        self.replica_db = self.replica_client[config.mongodb_database_name]
        self.read_db = self.replica_db
        self.write_db = self.replica_db  # Allow write operations
        logger.info(f"MongoDB initialized with read/write access - Replica: {config.mongodb_replica_uri}")
    
    def _get_collection(self, table: str, for_write: bool = False) -> Collection:
        """Get MongoDB collection for the given table."""
        db = self.write_db if for_write else self.read_db
        return db[table]
    
    def _convert_id(self, key: str) -> Union[str, ObjectId]:
        """Convert string key to ObjectId if it's a valid ObjectId, otherwise keep as string."""
        try:
            return ObjectId(key)
        except:
            return key
    
    def upsert_item(self, table: str, key: str, item: dict) -> dict:
        """Upsert an item into the specified table."""
        try:
            collection = self._get_collection(table, for_write=True)
            # Use the key as _id if it's not already present
            if '_id' not in item:
                item['_id'] = self._convert_id(key)
            
            result = collection.replace_one(
                {'_id': item['_id']}, 
                item, 
                upsert=True
            )
            
            if result.upserted_id:
                item['_id'] = str(result.upserted_id)
            else:
                item['_id'] = str(item['_id'])
                
            return item
        except PyMongoError as e:
            logger.error(f"Error upserting item in {table}: {e}")
            raise
    
    def insert_item(self, table: str, key: str, item: dict) -> dict:
        """Insert an item into the specified table."""
        try:
            collection = self._get_collection(table, for_write=True)
            # Use the key as _id if it's not already present
            if '_id' not in item:
                item['_id'] = self._convert_id(key)
            
            result = collection.insert_one(item)
            item['_id'] = str(result.inserted_id)
            return item
        except PyMongoError as e:
            logger.error(f"Error inserting item in {table}: {e}")
            raise
    
    def get_item(self, table: str, key: str) -> dict:
        """Retrieve an item by its key from the specified table."""
        try:
            collection = self._get_collection(table, for_write=False)
            doc_id = self._convert_id(key)
            item = collection.find_one({'_id': doc_id})
            
            if item:
                item['_id'] = str(item['_id'])
                return item
            return {}
        except PyMongoError as e:
            logger.error(f"Error getting item from {table}: {e}")
            raise
    
    def get_binary_item(self, table: str, key: str) -> bytes:
        """Retrieve a binary item by its key from the specified table."""
        try:
            collection = self._get_collection(table, for_write=False)
            doc_id = self._convert_id(key)
            item = collection.find_one({'_id': doc_id})
            
            if item and 'data' in item:
                return item['data']
            return b''
        except PyMongoError as e:
            logger.error(f"Error getting binary item from {table}: {e}")
            raise
    
    def get_all_items(self, table: str) -> list:
        """Retrieve all items from the specified table."""
        try:
            collection = self._get_collection(table, for_write=False)
            items = list(collection.find())
            
            # Convert ObjectIds to strings
            for item in items:
                item['_id'] = str(item['_id'])
            
            return items
        except PyMongoError as e:
            logger.error(f"Error getting all items from {table}: {e}")
            raise
    
    def update_item(self, table: str, key: str, updates: dict, include_nulls: bool = False) -> dict:
        """Update an item in the specified table."""
        try:
            collection = self._get_collection(table, for_write=True)
            doc_id = self._convert_id(key)
            filtered_updates = {
                k: v for k, v in updates.items()
                if k not in {"id", "_id"}
            }
            if not include_nulls:
                filtered_updates = {k: v for k, v in filtered_updates.items() if v is not None}
            if not filtered_updates:
                logger.warning("update_item called with no applicable fields for MongoDB collection %s", table)
                return self.get_item(table, key)

            result = collection.update_one(
                {'_id': doc_id}, 
                {'$set': filtered_updates}
            )
            
            if result.modified_count > 0:
                return self.get_item(table, key)
            return {}
        except PyMongoError as e:
            logger.error(f"Error updating item in {table}: {e}")
            raise
    
    def delete_item(self, table: str, key: str) -> None:
        """Delete an item from the specified table by its key."""
        try:
            collection = self._get_collection(table, for_write=True)
            doc_id = self._convert_id(key)
            collection.delete_one({'_id': doc_id})
        except PyMongoError as e:
            logger.error(f"Error deleting item from {table}: {e}")
            raise
    
    def query_items(self, table_name: str, criteria: dict) -> list:
        """Query the database for items matching the given criteria."""
        try:
            collection = self._get_collection(table_name, for_write=False)
            
            # Convert string IDs to ObjectIds if they look like ObjectIds
            query = {}
            for key, value in criteria.items():
                if key == '_id' and isinstance(value, str):
                    query[key] = self._convert_id(value)
                else:
                    query[key] = value
            
            items = list(collection.find(query))
            
            # Convert ObjectIds to strings
            for item in items:
                item['_id'] = str(item['_id'])
            
            return items
        except PyMongoError as e:
            logger.error(f"Error querying items from {table_name}: {e}")
            raise
    
    def search_by_key_part(self, table: str, key_part: str, regex: bool = False) -> List[Dict[str, Any]]:
        """Search for items whose keys contain or match a part of the given key."""
        try:
            collection = self._get_collection(table, for_write=False)
            
            if regex:
                import re
                pattern = re.compile(key_part, re.IGNORECASE)
                query = {'_id': pattern}
            else:
                # For MongoDB, we'll search by string pattern
                query = {'_id': {'$regex': key_part, '$options': 'i'}}
            
            items = list(collection.find(query))
            
            # Convert ObjectIds to strings
            for item in items:
                item['_id'] = str(item['_id'])
            
            return items
        except PyMongoError as e:
            logger.error(f"Error searching by key part in {table}: {e}")
            raise
    
    def copy_table(self, source_table: str, dest_table: str) -> None:
        """Copy all items from source_table to dest_table."""
        try:
            source_collection = self._get_collection(source_table, for_write=False)
            dest_collection = self._get_collection(dest_table, for_write=True)
            
            items = source_collection.find()
            if items.count() > 0:
                dest_collection.insert_many(items)
        except PyMongoError as e:
            logger.error(f"Error copying table {source_table} to {dest_table}: {e}")
            raise
    
    def query(self, querystr: str) -> list:
        """Execute a MongoDB aggregation pipeline and return results."""
        try:
            # Parse the query string as JSON (MongoDB aggregation pipeline)
            pipeline = json.loads(querystr)
            
            # Determine which database to use (default to read_db)
            db = self.read_db
            
            # Execute the aggregation pipeline
            result = list(db.command('aggregate', pipeline))
            return result
        except (json.JSONDecodeError, PyMongoError) as e:
            logger.error(f"Error executing MongoDB query: {e}")
            raise
    
    def insert_columns(
        self,
        table: str,
        columns: List[str],
        values: List[Any],
        conflict_strategy: str = "IGNORE"
    ) -> None:
        """
        Insert a new document into the collection with specified columns and values.
        """
        if len(columns) != len(values):
            raise ValueError(f"Number of columns ({len(columns)}) must match number of values ({len(values)})")
        
        try:
            collection = self._get_collection(table, for_write=True)
            document = dict(zip(columns, values))
            
            # Handle conflict strategy
            if conflict_strategy == "IGNORE" and 'id' in document:
                # Check if document exists
                existing = collection.find_one({"_id": self._convert_id(document['id'])})
                if existing:
                    logger.debug(f"Document with id {document['id']} already exists in {table}, ignoring insert")
                    return
            
            # Convert 'id' to '_id' for MongoDB
            if 'id' in document:
                document['_id'] = self._convert_id(document.pop('id'))
            
            collection.insert_one(document)
            logger.debug(f"Inserted document into {table} with columns {columns}")
            
        except PyMongoError as e:
            logger.error(f"Error inserting columns in {table}: {e}")
            raise

    def ensure_table(
        self,
        model: type[BaseModel],
        table_name: str = None
    ) -> None:
        """
        Ensure that a MongoDB collection exists for the given Pydantic model.
        In MongoDB, collections are created automatically when documents are inserted,
        so this method creates an empty collection and optionally sets up indexes.
        """
        if table_name is None:
            # Convert CamelCase to snake_case
            table_name = re.sub(r'(?<!^)(?=[A-Z])', '_', model.__name__).lower()
        
        try:
            collection = self._get_collection(table_name, for_write=True)
            
            # Create the collection if it doesn't exist by inserting and removing a dummy document
            if table_name not in self.write_db.list_collection_names():
                # Create collection by inserting a dummy document then removing it
                dummy_doc = {"_dummy": True}
                result = collection.insert_one(dummy_doc)
                collection.delete_one({"_id": result.inserted_id})
                logger.info(f"Created collection '{table_name}' for model {model.__name__}")
            else:
                logger.debug(f"Collection '{table_name}' already exists for model {model.__name__}")
                
            # Ensure _id index exists (MongoDB creates this automatically, but being explicit)
            collection.create_index("_id", unique=True)
            
        except PyMongoError as e:
            logger.error(f"Error ensuring collection for model {model.__name__}: {e}")
            raise
        except Exception as e:
            logger.error(f"Unexpected error ensuring collection for model {model.__name__}: {e}")
            raise
    
    def close(self):
        """Close database connections."""
        if self.replica_client:
            self.replica_client.close()
        logger.info("MongoDB read-only connections closed")
    
    def __enter__(self):
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()
