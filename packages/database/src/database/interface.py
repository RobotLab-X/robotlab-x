from abc import ABC, abstractmethod
from typing import List, Dict, Any, Union

# For factory pattern (like MessageConfig)
from pydantic import BaseModel

class DatabaseConfig(BaseModel):
    """Base pydantic config for database clients."""
    name: str

class DatabaseClient(ABC):
    """Abstract interface for database clients (sync, simple)."""
    @abstractmethod
    def insert_item(self, table: str, key: str, item: dict) -> dict:
        pass
    @abstractmethod
    def get_item(self, table: str, key: str) -> dict:
        pass
    @abstractmethod
    def get_all_items(self, table: str) -> list:
        pass
    @abstractmethod
    def delete_item(self, table: str, key: str) -> None:
        pass

class DatabaseAdapter(ABC):

    @abstractmethod
    def upsert_item(self, table: str, key: str, item: dict) -> dict:
        """Upsert an item into the specified table."""
        pass

    @abstractmethod
    def insert_item(self, table: str, key:str, item: dict) -> dict:
        """Insert an item into the specified table."""
        pass

    @abstractmethod
    def get_item(self, table: str, key: str) -> dict:
        """Retrieve an item by its key from the specified table."""
        pass

    @abstractmethod
    def get_binary_item(self, table: str, key: str) -> bytes:
        """Retrieve an item by its key from the specified table."""
        pass

    @abstractmethod
    def get_all_items(self, table: str) -> list:
        """Retrieve all items from the specified table."""
        pass

    @abstractmethod
    def update_item(self, table: str, key: str, updates: dict, include_nulls: bool = False) -> dict:
        """
        Update an item in the specified table.

        :param include_nulls: When False (default), None values in updates are ignored.
        """
        pass

    @abstractmethod
    def delete_item(self, table: str, key: str) -> None:
        """Delete an item from the specified table by its key."""
        pass

    @abstractmethod
    def query_items(self, table_name: str, criteria: dict) -> list:
        """Query the database for items matching the given criteria."""
        pass

    @abstractmethod
    def search_by_key_part(
        self, table: str, key_part: str, regex: bool = False
    ) -> List[Dict[str, Any]]:
        """
        Search for items whose keys contain or match a part of the given key.

        :param table: The table to search in.
        :param key_part: The key part to search for.
        :param regex: Whether to treat key_part as a regular expression. Defaults to False (prefix search).
        :return: A list of matching items.
        """
        pass

    @abstractmethod
    def copy_table(self, source_table: str, dest_table: str) -> None:
        """
        Copy all items from source_table to dest_table.
        """
        pass

    @abstractmethod
    def query(self, querystr: str, params: tuple = None) -> list:
        """
        Execute a backend-specific query string and return a list of results.
        For SQL backends, this is a SQL query with optional parameters. For others, NotImplementedError is raised.
        """
        pass


    @abstractmethod
    def insert_columns(
        self,
        table: str,
        columns: List[str],
        values: List[Any],
        conflict_strategy: str = "IGNORE"  # or "REPLACE", "FAIL", "ABORT"
    ) -> None:
        """
        Insert a new row into the table with specified columns and values.

        :param table: Table name.
        :param columns: List of column names to insert into.
        :param values: List of values corresponding to the columns.
        :param conflict_strategy: Optional SQL conflict strategy (e.g., IGNORE, REPLACE).
        """
        pass

    @abstractmethod
    def ensure_table(
        self,
        model: type[BaseModel],
        table_name: str = None
    ) -> None:
        """
        Ensure that a table exists for the given Pydantic model.

        :param model: The Pydantic model class to create a table for.
        :param table_name: Optional table name. If None, will use the lowercase snake_case name of the model.
        """
        pass

    def list_tables(self) -> List[str]:
        """
        Return the names of every table currently materialised in this backend.
        Non-abstract on purpose: existing adapters continue to work; only the
        ones that opt in (e.g. for admin / introspection UIs) need to implement it.
        """
        raise NotImplementedError(
            f"{type(self).__name__} does not implement list_tables(). "
            "Admin/introspection features that depend on enumerating tables "
            "are unavailable for this backend."
        )
