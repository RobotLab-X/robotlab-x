from typing import List, TypeVar, Type, Optional, Any, Dict, Generic
from pydantic import BaseModel, ValidationError
from .interface import DatabaseAdapter
import logging

logger = logging.getLogger(__name__)

# Type variable for Pydantic models
T = TypeVar('T', bound=BaseModel)

class TypedDatabaseAdapter:
    """
    Type-safe database adapter that works with Pydantic models.
    
    This adapter wraps an existing DatabaseAdapter and provides type-safe operations
    by automatically converting between Pydantic models and dictionaries.
    """
    
    def __init__(self, adapter: DatabaseAdapter):
        """
        Initialize the typed adapter with an existing DatabaseAdapter.
        
        Args:
            adapter: The underlying DatabaseAdapter instance to wrap
        """
        self._adapter = adapter
    
    def upsert_item(self, table: str, key: str, item: BaseModel) -> BaseModel:
        """
        Upsert a Pydantic model item into the specified table.
        
        Args:
            table: The table name
            key: The item key
            item: The Pydantic model instance to upsert
            
        Returns:
            The upserted item as a Pydantic model instance
        """
        item_dict = item.model_dump()
        result_dict = self._adapter.upsert_item(table, key, item_dict)
        return type(item)(**result_dict)
    
    def insert_item(self, table: str, key: str, item: BaseModel) -> BaseModel:
        """
        Insert a Pydantic model item into the specified table.
        
        Args:
            table: The table name
            key: The item key
            item: The Pydantic model instance to insert
            
        Returns:
            The inserted item as a Pydantic model instance
        """
        item_dict = item.model_dump()
        result_dict = self._adapter.insert_item(table, key, item_dict)
        return type(item)(**result_dict)
    
    def get_item(self, table: str, key: str, model_class: Type[T]) -> Optional[T]:
        """
        Retrieve and parse a typed item by its key from the specified table.
        
        Args:
            table: The table name
            key: The item key
            model_class: The Pydantic model class to parse the result into
            
        Returns:
            The parsed item as a Pydantic model instance, or None if not found
        """
        try:
            result_dict = self._adapter.get_item(table, key)
            if not result_dict:
                return None
            return model_class(**result_dict)
        except ValidationError as e:
            logger.warning(f"Failed to parse item {key} as {model_class.__name__}: {e}")
            raise
        except Exception as e:
            logger.error(f"Error retrieving item {key} from table {table}: {e}")
            raise
    
    def get_binary_item(self, table: str, key: str) -> bytes:
        """
        Retrieve a binary item by its key from the specified table.
        
        Args:
            table: The table name
            key: The item key
            
        Returns:
            The binary data
        """
        return self._adapter.get_binary_item(table, key)
    
    def get_all_items(self, table: str, model_class: Type[T]) -> List[T]:
        """
        Retrieve and parse all typed items from the specified table.
        
        Args:
            table: The table name
            model_class: The Pydantic model class to parse results into
            
        Returns:
            A list of parsed items as Pydantic model instances
        """
        results = []
        try:
            raw_items = self._adapter.get_all_items(table)
            
            for item_dict in raw_items:
                try:
                    results.append(model_class(**item_dict))
                except ValidationError as e:
                    logger.warning(f"Failed to parse item as {model_class.__name__}: {e}")
                    raise
                except Exception as e:
                    logger.warning(f"Error parsing item from table {table}: {e}")
                    raise
        except Exception as e:
            logger.error(f"Error retrieving items from table {table}: {e}")
            raise
        
        return results
    
    def update_item(self, table: str, key: str, updates: BaseModel, include_nulls: bool = False) -> BaseModel:
        """
        Update an item in the specified table with a Pydantic model.
        
        Args:
            table: The table name
            key: The item key
            updates: The Pydantic model containing updates
            include_nulls: When True, None values will overwrite existing values.
            
        Returns:
            The updated item as a Pydantic model instance
        """
        updates_dict = updates.model_dump(exclude_unset=True)
        result_dict = self._adapter.update_item(table, key, updates_dict, include_nulls=include_nulls)
        return type(updates)(**result_dict)
    
    def delete_item(self, table: str, key: str) -> None:
        """
        Delete an item from the specified table by its key.
        
        Args:
            table: The table name
            key: The item key to delete
        """
        self._adapter.delete_item(table, key)
    
    def query_items(self, table: str, criteria: BaseModel, model_class: Type[T]) -> List[T]:
        """
        Query the database for typed items matching the given criteria.
        
        Args:
            table: The table name
            criteria: A Pydantic model containing the query criteria
            model_class: The Pydantic model class to parse results into
            
        Returns:
            A list of matching items as Pydantic model instances
        """
        criteria_dict = criteria.model_dump(exclude_unset=True)
        return self.query_items_dict(table, criteria_dict, model_class)
    
    def query_items_dict(self, table: str, criteria: Dict[str, Any], model_class: Type[T]) -> List[T]:
        """
        Query the database for typed items matching the given criteria (dict version).
        
        Args:
            table: The table name
            criteria: A dictionary containing the query criteria
            model_class: The Pydantic model class to parse results into
            
        Returns:
            A list of matching items as Pydantic model instances
        """
        results = []
        try:
            raw_results = self._adapter.query_items(table, criteria)
            
            for item_dict in raw_results:
                try:
                    results.append(model_class(**item_dict))
                except ValidationError as e:
                    logger.warning(f"Failed to parse query result as {model_class.__name__}: {e}")
                    raise
                except Exception as e:
                    logger.warning(f"Error parsing query result from table {table}: {e}")
                    raise
        except Exception as e:
            logger.error(f"Error querying table {table} with criteria {criteria}: {e}")
            raise
        
        return results
    
    def search_by_key_part(
        self, table: str, key_part: str, model_class: Type[T], regex: bool = False
    ) -> List[T]:
        """
        Search for typed items whose keys contain or match a part of the given key.
        
        Args:
            table: The table to search in
            key_part: The key part to search for
            model_class: The Pydantic model class to parse results into
            regex: Whether to treat key_part as a regular expression
            
        Returns:
            A list of matching items as Pydantic model instances
        """
        results = []
        try:
            raw_results = self._adapter.search_by_key_part(table, key_part, regex)
            
            for item_dict in raw_results:
                try:
                    results.append(model_class(**item_dict))
                except ValidationError as e:
                    logger.warning(f"Failed to parse search result as {model_class.__name__}: {e}")
                    raise
                except Exception as e:
                    logger.warning(f"Error parsing search result from table {table}: {e}")
                    raise
        except Exception as e:
            logger.error(f"Error searching table {table} for key part '{key_part}': {e}")
            raise
        
        return results
    
    def copy_table(self, source_table: str, dest_table: str) -> None:
        """
        Copy all items from source_table to dest_table.
        
        Args:
            source_table: The source table name
            dest_table: The destination table name
        """
        self._adapter.copy_table(source_table, dest_table)
    
    def query(self, querystr: str, params: tuple = None) -> List[Dict[str, Any]]:
        """
        Execute a backend-specific query string and return a list of results.
        
        Args:
            querystr: The query string (e.g., SQL for SQL backends)
            params: Optional query parameters
            
        Returns:
            A list of result dictionaries
        """
        return self._adapter.query(querystr, params)
    
    def query_typed(self, querystr: str, model_class: Type[T], params: tuple = None) -> List[T]:
        """
        Execute a backend-specific query string and return typed results.
        
        Args:
            querystr: The query string (e.g., SQL for SQL backends)
            model_class: The Pydantic model class to parse results into
            params: Optional query parameters
            
        Returns:
            A list of parsed results as Pydantic model instances
        """
        results = []
        try:
            raw_results = self._adapter.query(querystr, params)
            
            for item_dict in raw_results:
                try:
                    results.append(model_class(**item_dict))
                except ValidationError as e:
                    logger.warning(f"Failed to parse query result as {model_class.__name__}: {e}")
                    raise
                except Exception as e:
                    logger.warning(f"Error parsing query result: {e}")
                    raise
        except Exception as e:
            logger.error(f"Error executing query '{querystr}': {e}")
            raise
        
        return results
    
    def insert_columns(
        self,
        table: str,
        columns: List[str],
        values: List[Any],
        conflict_strategy: str = "IGNORE"
    ) -> None:
        """
        Insert a new row into the table with specified columns and values.
        
        Args:
            table: Table name
            columns: List of column names to insert into
            values: List of values corresponding to the columns
            conflict_strategy: Optional SQL conflict strategy (e.g., IGNORE, REPLACE)
        """
        self._adapter.insert_columns(table, columns, values, conflict_strategy)
    
    # Property to access the underlying adapter if needed
    @property
    def underlying_adapter(self) -> DatabaseAdapter:
        """
        Access the underlying DatabaseAdapter instance.
        
        Returns:
            The wrapped DatabaseAdapter instance
        """
        return self._adapter


class DomainService(Generic[T]):
    """
    Abstract base class for domain-specific typed database services.
    
    This provides a convenient pattern for creating services that work with
    specific domain models and tables.
    """
    
    def __init__(self, typed_adapter: TypedDatabaseAdapter, table_name: str, model_class: Type[T]):
        """
        Initialize the domain service.
        
        Args:
            typed_adapter: The TypedDatabaseAdapter instance
            table_name: The table this service operates on
            model_class: The Pydantic model class for this domain
        """
        self._adapter = typed_adapter
        self._table = table_name
        self._model_class = model_class
    
    def create(self, key: str, item: T) -> T:
        """Create a new domain object."""
        return self._adapter.insert_item(self._table, key, item)
    
    def get(self, key: str) -> Optional[T]:
        """Get a domain object by key."""
        return self._adapter.get_item(self._table, key, self._model_class)
    
    def update(self, key: str, updates: T, include_nulls: bool = False) -> T:
        """Update a domain object."""
        return self._adapter.update_item(self._table, key, updates, include_nulls=include_nulls)
    
    def upsert(self, key: str, item: T) -> T:
        """Upsert a domain object."""
        return self._adapter.upsert_item(self._table, key, item)
    
    def delete(self, key: str) -> None:
        """Delete a domain object."""
        self._adapter.delete_item(self._table, key)
    
    def list_all(self) -> List[T]:
        """List all domain objects."""
        return self._adapter.get_all_items(self._table, self._model_class)
    
    def query(self, criteria: BaseModel) -> List[T]:
        """Query domain objects with typed criteria."""
        return self._adapter.query_items(self._table, criteria, self._model_class)
    
    def query_dict(self, criteria: Dict[str, Any]) -> List[T]:
        """Query domain objects with dict criteria."""
        return self._adapter.query_items_dict(self._table, criteria, self._model_class)
    
    def search_by_key(self, key_part: str, regex: bool = False) -> List[T]:
        """Search domain objects by key part."""
        return self._adapter.search_by_key_part(self._table, key_part, self._model_class, regex)
