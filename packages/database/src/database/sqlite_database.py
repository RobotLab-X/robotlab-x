import sqlite3
import os
import logging
import re
import json
from typing import Dict, List, Any, Union
from .interface import DatabaseAdapter
from .record_transformer import RecordTransformer
import threading
from pydantic import BaseModel

try:
    from pydantic.fields import Undefined
except ImportError:  # pragma: no cover - depends on Pydantic version
    try:
        from pydantic_core import PydanticUndefined as Undefined
    except ImportError:  # pragma: no cover
        Undefined = object()

logger = logging.getLogger(__name__)

from models.database_sqlite_config import DatabaseSqliteConfig

class SqliteDatabase(DatabaseAdapter):
    _instance = None
    _lock = threading.Lock()

    def __new__(cls, config: DatabaseSqliteConfig):
        if not cls._instance:
            with cls._lock:
                if not cls._instance:
                    cls._instance = super(SqliteDatabase, cls).__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self, config: DatabaseSqliteConfig):
        if getattr(self, '_initialized', False):
            return
        self._initialized = True
        self.config = config
        dirpath = os.path.dirname(self.config.sqlite_path)
        if dirpath:
            os.makedirs(dirpath, exist_ok=True)
        self.conn = sqlite3.connect(self.config.sqlite_path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.transformer = RecordTransformer()
        logger.info(f"SqliteDatabase initialized at {self.config.sqlite_path}")

    def _get_connection(self):
        """Get a new SQLite connection for each operation (thread-safe)."""
        conn = sqlite3.connect(self.config.sqlite_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    _IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

    @classmethod
    def _safe_ident(cls, ident: str, kind: str = "identifier") -> str:
        """Validate then quote a SQL identifier. sqlite3 has no parameterized-identifier
        API like psycopg2.sql.Identifier, so the only safe path is allowlist + quote.
        Accepts identifiers matching ``[A-Za-z_][A-Za-z0-9_]*`` and returns them
        wrapped in double quotes (sqlite's standard delimited-identifier syntax).
        Anything else raises ValueError before reaching the engine.
        """
        if not isinstance(ident, str) or not cls._IDENT_RE.match(ident):
            raise ValueError(f"invalid {kind}: {ident!r}")
        return f'"{ident}"'

    def upsert_item(self, table: str, key: str, item: dict) -> dict:
        t = self._safe_ident(table, "table name")
        flat_item = self.transformer.flatten(item)
        columns = list(flat_item.keys())
        values = [flat_item[col] for col in columns]
        if 'id' not in columns:
            columns = ['id'] + columns
            values = [key] + values
        cols_sql = ', '.join(self._safe_ident(c, f"column '{c}'") for c in columns)
        placeholders = ', '.join(['?'] * len(values))
        conn = self._get_connection()
        cur = conn.cursor()
        cur.execute(f"INSERT OR REPLACE INTO {t} ({cols_sql}) VALUES ({placeholders})", values)
        conn.commit()
        conn.close()
        return item

    def insert_item(self, table: str, key: str, item: dict) -> dict:
        return self.upsert_item(table, key, item)

    def get_item(self, table: str, key: str) -> dict:
        t = self._safe_ident(table, "table name")
        conn = self._get_connection()
        cur = conn.cursor()
        cur.execute(f"PRAGMA table_info({t})")
        columns = [row[1] for row in cur.fetchall()]
        cur.execute(f"SELECT * FROM {t} WHERE id = ?", (key,))
        row = cur.fetchone()
        conn.close()
        if row:
            row_dict = dict(zip(columns, row))
            return self.transformer.unflatten(row_dict)
        return {}

    def get_binary_item(self, table: str, key: str) -> bytes:
        t = self._safe_ident(table, "table name")
        conn = self._get_connection()
        try:
            cur = conn.cursor()
            cur.execute(f"PRAGMA table_info({t})")
            columns = [row[1] for row in cur.fetchall()]
            if not columns:
                raise ValueError(f"Table {table} does not exist")

            if "json" in columns:
                cur.execute(f"SELECT json FROM {t} WHERE id = ?", (key,))
                row = cur.fetchone()
                if row and row[0] is not None:
                    data = row[0]
                    if isinstance(data, (bytes, bytearray)):
                        return bytes(data)
                    return str(data).encode("utf-8")
            else:
                cur.execute(f"SELECT * FROM {t} WHERE id = ?", (key,))
                row = cur.fetchone()
                if row:
                    record = dict(zip(columns, row))
                    payload = json.dumps(
                        record,
                        default=lambda obj: obj.decode("utf-8") if isinstance(obj, (bytes, bytearray)) else str(obj)
                    )
                    return payload.encode("utf-8")
            raise ValueError(f"Item with key {key} not found in {table}")
        finally:
            conn.close()

    def get_all_items(self, table: str) -> list:
        try:
            t = self._safe_ident(table, "table name")
            conn = self._get_connection()
            cur = conn.cursor()
            cur.execute(f"PRAGMA table_info({t})")
            columns = [row[1] for row in cur.fetchall()]
            cur.execute(f"SELECT * FROM {t}")
            rows = cur.fetchall()
            conn.close()
            return [self.transformer.unflatten(dict(zip(columns, row))) for row in rows]
        except Exception as e:
            logger.error(f"Error retrieving all items from {table}: {e}")
            return []

    def update_item(self, table: str, key: str, updates: dict, include_nulls: bool = False) -> dict:
        item = self.get_item(table, key)
        if not item:
            return {}
        filtered_updates = {k: v for k, v in updates.items() if k != "id"}
        if not include_nulls:
            filtered_updates = {k: v for k, v in filtered_updates.items() if v is not None}
        if not filtered_updates:
            logger.warning("update_item called with no applicable fields for sqlite table %s", table)
            return item
        item.update(filtered_updates)
        return self.insert_item(table, key, item)

    def delete_item(self, table: str, key: str) -> None:
        t = self._safe_ident(table, "table name")
        conn = self._get_connection()
        cur = conn.cursor()
        cur.execute(f"DELETE FROM {t} WHERE id = ?", (key,))
        conn.commit()
        conn.close()

    def query_items(self, table_name: str, criteria: dict) -> list:
        t = self._safe_ident(table_name, "table name")
        conn = self._get_connection()
        cur = conn.cursor()
        cur.execute(f"PRAGMA table_info({t})")
        columns = [row[1] for row in cur.fetchall()]
        cur.execute(f"SELECT * FROM {t}")
        rows = cur.fetchall()
        conn.close()
        results = []
        for row in rows:
            row_dict = dict(zip(columns, row))
            item = self.transformer.unflatten(row_dict)
            if all(item.get(k) == v for k, v in criteria.items()):
                results.append(item)
        return results

    def search_by_key_part(self, table: str, key_part: str, regex: bool = False) -> List[Dict[str, Any]]:
        t = self._safe_ident(table, "table name")
        conn = self._get_connection()
        cur = conn.cursor()
        cur.execute(f"PRAGMA table_info({t})")
        columns = [row[1] for row in cur.fetchall()]
        cur.execute(f"SELECT * FROM {t}")
        rows = cur.fetchall()
        conn.close()
        results = []
        for row in rows:
            row_dict = dict(zip(columns, row))
            item = self.transformer.unflatten(row_dict)
            id_val = row_dict.get('id', '')
            if regex:
                if re.search(key_part, id_val):
                    results.append(item)
            else:
                if id_val.startswith(key_part):
                    results.append(item)
        return results

    def copy_table(self, source_table: str, dest_table: str) -> None:
        src = self._safe_ident(source_table, "source table")
        # dest_table is validated inside the subsequent insert_item → upsert_item path.
        conn = self._get_connection()
        cur = conn.cursor()
        cur.execute(f"PRAGMA table_info({src})")
        columns = [row[1] for row in cur.fetchall()]
        cur.execute(f"SELECT * FROM {src}")
        rows = cur.fetchall()
        conn.close()
        for row in rows:
            row_dict = dict(zip(columns, row))
            item = self.transformer.unflatten(row_dict)
            self.insert_item(dest_table, row_dict['id'], item)

    def query(self, querystr: str) -> list:
        conn = self._get_connection()
        cur = conn.cursor()
        cur.execute(querystr)
        if cur.description:  # SELECT or similar
            columns = [desc[0] for desc in cur.description]
            rows = cur.fetchall()
            conn.close()
            # Always unflatten rows before returning
            return [self.transformer.unflatten(dict(zip(columns, row))) for row in rows]
        else:  # INSERT, UPDATE, DELETE, etc.
            conn.commit()
            conn.close()
            return []

    def insert_columns(
        self,
        table: str,
        columns: List[str],
        values: List[Any],
        conflict_strategy: str = "IGNORE"
    ) -> None:
        """
        Insert a new row into the table with specified columns and values.
        """
        if len(columns) != len(values):
            raise ValueError(f"Number of columns ({len(columns)}) must match number of values ({len(values)})")

        if conflict_strategy not in {"IGNORE", "REPLACE", "ABORT", "FAIL", "ROLLBACK"}:
            raise ValueError(f"invalid conflict_strategy: {conflict_strategy!r}")

        t = self._safe_ident(table, "table name")
        cols_sql = ', '.join(self._safe_ident(c, f"column '{c}'") for c in columns)
        placeholders = ', '.join(['?'] * len(values))
        conn = self._get_connection()
        cur = conn.cursor()
        try:
            cur.execute(
                f"INSERT OR {conflict_strategy} INTO {t} ({cols_sql}) VALUES ({placeholders})",
                values,
            )
            conn.commit()
            conn.close()
            logger.debug(f"Inserted row into {table} with columns {columns}")
        except Exception as e:
            logger.error(f"Failed to insert into {table}: {e}")
            conn.close()
            raise
    
    def ensure_table(
        self,
        model: type[BaseModel],
        table_name: str = None
    ) -> None:
        """
        Ensure that a table exists for the given Pydantic model.
        Creates the table with columns based on the Pydantic model fields.
        """
        if table_name is None:
            # Convert CamelCase to snake_case
            table_name = re.sub(r'(?<!^)(?=[A-Z])', '_', model.__name__).lower()

        t = self._safe_ident(table_name, "table name")

        try:
            # Get field definitions from Pydantic model
            if hasattr(model, "model_fields"):
                fields = model.model_fields
            else:
                fields = getattr(model, "__fields__", {})

            # SQLite types come from a fixed allowlist (_get_sqlite_type); the only
            # caller-controlled tokens are field/column names, which we run through
            # _safe_ident below.
            columns = [f"{self._safe_ident('id', 'column id')} TEXT PRIMARY KEY"]

            for field_name, field_info in fields.items():
                if field_name == 'id':
                    continue

                field_type = field_info.annotation if hasattr(field_info, 'annotation') else field_info
                sqlite_type = self._get_sqlite_type(field_type)

                is_optional = False
                if hasattr(field_info, 'is_required'):
                    is_required_attr = field_info.is_required
                    if callable(is_required_attr):
                        is_optional = not bool(is_required_attr())
                    else:
                        is_optional = not bool(is_required_attr)

                default_value = getattr(field_info, 'default', Undefined)
                if default_value is not Undefined:
                    is_optional = True

                default_factory = getattr(field_info, 'default_factory', None)
                if default_factory not in (None, Undefined):
                    is_optional = True

                if hasattr(field_info, 'annotation'):
                    annotation = field_info.annotation
                    if hasattr(annotation, '__origin__') and annotation.__origin__ is Union:
                        if type(None) in getattr(annotation, '__args__', ()):
                            is_optional = True

                null_constraint = "" if is_optional else " NOT NULL"
                columns.append(
                    f"{self._safe_ident(field_name, f'column {field_name!r}')} {sqlite_type}{null_constraint}"
                )

            columns_sql = ",\n    ".join(columns)
            create_sql = f"CREATE TABLE IF NOT EXISTS {t} (\n    {columns_sql}\n)"

            conn = self._get_connection()
            cur = conn.cursor()
            cur.execute(create_sql)
            conn.commit()
            conn.close()
            logger.info(f"Ensured table '{table_name}' exists for model {model.__name__}")
                
        except Exception as e:
            logger.error(f"Error ensuring table for model {model.__name__}: {e}")
            raise
    
    def _get_sqlite_type(self, python_type) -> str:
        """Convert Python/Pydantic type to SQLite type."""
        type_mapping = {
            str: "TEXT",
            int: "INTEGER", 
            float: "REAL",
            bool: "INTEGER",  # SQLite stores booleans as integers
            dict: "TEXT",     # Store as JSON text
            list: "TEXT",     # Store as JSON text
        }
        
        # Handle typing annotations
        if hasattr(python_type, '__origin__'):
            origin = python_type.__origin__
            if origin is list:
                return "TEXT"  # Store as JSON
            elif origin is dict:
                return "TEXT"  # Store as JSON
            elif origin is Union:
                # For Optional types, get the non-None type
                args = [arg for arg in python_type.__args__ if arg is not type(None)]
                if args:
                    return self._get_sqlite_type(args[0])
        
        # Direct type lookup
        if python_type in type_mapping:
            return type_mapping[python_type]
        
        # Default to TEXT for unknown types
        return "TEXT"
