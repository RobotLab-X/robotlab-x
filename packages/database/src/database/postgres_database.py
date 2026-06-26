import logging
import datetime
from typing import Dict, List, Any, Optional, Union
import psycopg2
from psycopg2 import sql
from psycopg2.extras import RealDictCursor, register_default_jsonb
from psycopg2 import OperationalError, InterfaceError
from psycopg2.pool import ThreadedConnectionPool, PoolError
import threading
import time
import json
import re
from contextlib import contextmanager
from .interface import DatabaseAdapter
from models.database_postgres_config import DatabasePostgresConfig
from pydantic import BaseModel

logger = logging.getLogger(__name__)

class PostgresDatabase(DatabaseAdapter):
    def __init__(self, config: DatabasePostgresConfig):
        self.config = config
        self.sslmode = config.sslmode if config.sslmode not in (None, "None", "") else "prefer"
        self._pool = None
        self._lock = threading.Lock()
        self._connect()
        logger.info(f"PostgresDatabase initialized with connection pool (min={config.min_connections}, max={config.max_connections}) at {config.host}:{config.port}/{config.database}")

    def _connect(self) -> None:
        """Create a connection pool"""
        try:
            if self._pool:
                try:
                    self._pool.closeall()
                except Exception as e:
                    logger.warning(f"Error closing existing pool: {e}")
            
            self._pool = ThreadedConnectionPool(
                minconn=self.config.min_connections,
                maxconn=self.config.max_connections,
                host=self.config.host,
                port=self.config.port,
                user=self.config.user,
                password=self.config.password,
                dbname=self.config.database,
                sslmode=self.sslmode,
                connect_timeout=10,
                # Enable TCP keepalives to detect dead connections
                keepalives_idle=600,
                keepalives_interval=30,
                keepalives_count=3
            )
            register_default_jsonb(globally=True, loads=json.loads)
            logger.info(f"Database connection pool established with {self.config.min_connections}-{self.config.max_connections} connections")
        except Exception as e:
            logger.error(f"Failed to create connection pool: {e}")
            self._pool = None
            raise

    @contextmanager
    def _get_cursor(self, cursor_factory=None):
        """Context manager for database cursors with connection pooling and automatic retry"""
        # Validate pool exists
        if not self._pool:
            logger.error("Connection pool not initialized")
            raise OperationalError("Database connection pool is not available")
        
        max_retries = 3
        conn = None
        
        for attempt in range(max_retries):
            try:
                # Get a connection from the pool
                conn = self._pool.getconn()
                if not conn:
                    raise OperationalError("Failed to get connection from pool")
                
                conn.autocommit = True
                cursor_error = False
                
                try:
                    with conn.cursor(cursor_factory=cursor_factory) as cursor:
                        yield cursor
                        # Success - cursor is now closed, safe to return connection
                except Exception as cursor_exc:
                    # Mark that an error occurred during cursor operations
                    cursor_error = True
                    raise
                finally:
                    # Always return connection to pool after cursor is closed
                    if cursor_error:
                        # Close the connection if there was an error
                        try:
                            self._pool.putconn(conn, close=True)
                        except Exception as put_error:
                            logger.error(f"Error returning bad connection to pool: {put_error}")
                            # If putconn fails, rebuild pool state to avoid leaked checkout slots.
                            try:
                                with self._lock:
                                    self._connect()
                            except Exception as reconnect_error:
                                logger.error(f"Error rebuilding pool after bad-connection return failure: {reconnect_error}")
                    else:
                        # Return healthy connection to pool
                        try:
                            self._pool.putconn(conn)
                        except Exception as put_error:
                            logger.error(f"Error returning connection to pool: {put_error}")
                            # Try to close the connection if we can't return it
                            try:
                                conn.close()
                            except:
                                pass
                            # Recover pool bookkeeping if putconn itself failed.
                            try:
                                with self._lock:
                                    self._connect()
                            except Exception as reconnect_error:
                                logger.error(f"Error rebuilding pool after return failure: {reconnect_error}")
                
                # If we get here, operation succeeded - exit retry loop
                return
                
            except (OperationalError, InterfaceError, PoolError) as e:
                logger.warning(f"Database operation failed (attempt {attempt + 1}/{max_retries}): {e}")
                # Connection already returned to pool in finally block above

                if isinstance(e, PoolError) and "exhausted" in str(e).lower():
                    logger.warning("Connection pool exhausted; rebuilding pool before retry")
                    try:
                        with self._lock:
                            self._connect()
                    except Exception as reconnect_error:
                        logger.error(f"Failed to rebuild exhausted pool: {reconnect_error}")
                
                if attempt == max_retries - 1:
                    logger.error(f"All {max_retries} retry attempts failed")
                    raise
                    
                # Exponential backoff before retry
                time.sleep(0.5 * (attempt + 1))
            except Exception as e:
                logger.error(f"Unexpected error in database operation: {e}")
                # Connection already returned to pool in finally block above
                raise

    def close(self) -> None:
        """Clean shutdown of database connection pool"""
        with self._lock:
            if self._pool:
                try:
                    self._pool.closeall()
                    logger.info("Database connection pool closed")
                except Exception as e:
                    logger.error(f"Error closing database connection pool: {e}")
                finally:
                    self._pool = None

    def _render_sql_for_logging(self, cur, statement: Any, params: Optional[Union[list, tuple]] = None) -> Optional[str]:
        """Render SQL using psycopg2 quoting for debug logs."""
        if not logger.isEnabledFor(logging.DEBUG):
            return None

        try:
            rendered_statement = statement.as_string(cur) if isinstance(statement, sql.Composable) else statement
            if params is None:
                return rendered_statement
            return cur.mogrify(rendered_statement, params).decode("utf-8")
        except Exception as exc:
            logger.debug("Unable to render SQL for logging: %s", exc)
            return None

    def _execute(self, cur, statement: Any, params: Optional[Union[list, tuple]] = None) -> None:
        rendered_sql = self._render_sql_for_logging(cur, statement, params)
        if rendered_sql:
            logger.debug("SQL: %s", rendered_sql)

        if params is None:
            cur.execute(statement)
        else:
            cur.execute(statement, params)

    def _infer_columns(self, item: dict) -> Dict[str, str]:
        """Infer PostgreSQL column types from Python values - use TEXT for mixed types"""
        columns = {}
        for k, v in item.items():
            if v is None:
                columns[k] = "TEXT"
            elif isinstance(v, bool):
                columns[k] = "BOOLEAN"
            elif isinstance(v, list):
                # Always use JSONB for lists (do NOT use TEXT[])
                columns[k] = "JSONB"
            elif isinstance(v, dict):
                columns[k] = "JSONB"
            elif isinstance(v, datetime.datetime):
                columns[k] = "TIMESTAMPTZ"
            elif isinstance(v, float):
                columns[k] = "DOUBLE PRECISION"
            elif isinstance(v, int):
                if k.lower() in ['zip', 'zipcode', 'postal_code', 'phone', 'id', 'code', 'number', 'parcel_id', 'parcel_number', 'raw_parcel_number', 'cs', 'owner_zip']:
                    columns[k] = "TEXT"
                else:
                    columns[k] = "BIGINT"
            else:
                columns[k] = "TEXT"
        return columns

    def _prepare_values(self, item: dict) -> List:
        """Convert Python values to PostgreSQL-compatible format"""
        values = []
        try:
            for k, v in item.items():
                if isinstance(v, (list, dict)):
                    # Serialize lists and dicts to JSON for jsonb columns
                    values.append(json.dumps(v))
                else:
                    values.append(v)
            return values
        except Exception as e:
            logger.error(f"Error in _prepare_values with item keys {list(item.keys())}: {e}")
            logger.error(f"Item: {item}")
            raise

    def upsert_item(self, table: str, key: str, item: dict) -> Optional[dict]:
        """Upsert item with validation"""
        self._validate_identifier(table, "table name")
        for k in item.keys():
            self._validate_identifier(k, f"column '{k}'")

        if not item:
            raise ValueError("Cannot upsert empty item")
        if 'id' not in item:
            raise ValueError("Item must contain 'id' field")

        try:
            values = self._prepare_values(item)
            if len(values) != len(item):
                raise ValueError(f"Values count ({len(values)}) doesn't match item keys count ({len(item)})")

            stmt = sql.SQL(
                "INSERT INTO {table} ({cols}) VALUES ({vals}) "
                "ON CONFLICT (id) DO UPDATE SET {upd} RETURNING *"
            ).format(
                table=sql.Identifier(table),
                cols=sql.SQL(", ").join(sql.Identifier(k) for k in item.keys()),
                vals=sql.SQL(", ").join(sql.Placeholder() for _ in item),
                upd=sql.SQL(", ").join(
                    sql.SQL("{c}=EXCLUDED.{c}").format(c=sql.Identifier(k))
                    for k in item.keys()
                ),
            )

            with self._get_cursor(cursor_factory=RealDictCursor) as cur:
                self._execute(cur, stmt, values)
                result = cur.fetchone()
                return dict(result) if result else None
        except Exception as e:
            logger.error(f"Error in upsert_item for table '{table}', key '{key}': {e}")
            logger.error(f"Item keys: {list(item.keys())}")
            raise

    def insert_item(self, table: str, key: str, item: dict) -> Optional[dict]:
        """Insert item with validation"""
        self._validate_identifier(table, "table name")
        for k in item.keys():
            self._validate_identifier(k, f"column '{k}'")

        if not item:
            raise ValueError("Cannot insert empty item")
        if 'id' not in item:
            raise ValueError("Item must contain 'id' field")

        try:
            values = self._prepare_values(item)
            stmt = sql.SQL(
                "INSERT INTO {table} ({cols}) VALUES ({vals}) RETURNING *"
            ).format(
                table=sql.Identifier(table),
                cols=sql.SQL(", ").join(sql.Identifier(k) for k in item.keys()),
                vals=sql.SQL(", ").join(sql.Placeholder() for _ in item),
            )

            with self._get_cursor(cursor_factory=RealDictCursor) as cur:
                self._execute(cur, stmt, values)
                result = cur.fetchone()
                return dict(result) if result else None
        except Exception as e:
            logger.error(f"Error in insert_item for table '{table}', key '{key}': {e}")
            logger.error(f"Item keys: {list(item.keys())}")
            raise

    def get_item(self, table: str, key: str) -> Optional[dict]:
        """Get item with validation"""
        self._validate_identifier(table, "table name")

        try:
            with self._get_cursor(cursor_factory=RealDictCursor) as cur:
                stmt = sql.SQL("SELECT * FROM {table} WHERE id = %s").format(
                    table=sql.Identifier(table),
                )
                self._execute(cur, stmt, (key,))
                result = cur.fetchone()
                return dict(result) if result else None
        except Exception as e:
            logger.error(f"Error in get_item: {e}")
            raise

    def get_all_items(self, table: str) -> List[dict]:
        """Get all items with validation"""
        self._validate_identifier(table, "table name")

        try:
            with self._get_cursor(cursor_factory=RealDictCursor) as cur:
                stmt = sql.SQL("SELECT * FROM {table}").format(
                    table=sql.Identifier(table),
                )
                self._execute(cur, stmt)
                return [dict(row) for row in cur.fetchall()]
        except Exception as e:
            logger.error(f"Error in get_all_items: {e}")
            raise

    def delete_item(self, table: str, key: str) -> None:
        """Delete item with validation"""
        self._validate_identifier(table, "table name")

        try:
            with self._get_cursor() as cur:
                stmt = sql.SQL("DELETE FROM {table} WHERE id = %s").format(
                    table=sql.Identifier(table),
                )
                self._execute(cur, stmt, (key,))
        except Exception as e:
            logger.error(f"Error in delete_item: {e}")
            raise

    def update_item(self, table: str, key: str, updates: dict, include_nulls: bool = False) -> dict:
        """Update item with validation"""
        self._validate_identifier(table, "table name")

        try:
            # Never allow callers to modify the primary key; rely on `key`.
            filtered_updates = {k: v for k, v in updates.items() if k != "id"}
            if not include_nulls:
                filtered_updates = {k: v for k, v in filtered_updates.items() if v is not None}
            if not filtered_updates:
                logger.warning("update_item called with no updatable fields")
                return {}

            for k in filtered_updates.keys():
                self._validate_identifier(k, f"column '{k}'")

            values = self._prepare_values(filtered_updates)
            stmt = sql.SQL("UPDATE {table} SET {assignments} WHERE id = %s RETURNING *").format(
                table=sql.Identifier(table),
                assignments=sql.SQL(", ").join(
                    sql.SQL("{c} = %s").format(c=sql.Identifier(k))
                    for k in filtered_updates.keys()
                ),
            )

            with self._get_cursor(cursor_factory=RealDictCursor) as cur:
                self._execute(cur, stmt, values + [key])
                result = cur.fetchone()
                return dict(result) if result else {}
        except Exception as e:
            logger.error(f"Error in update_item: {e}")
            raise

    def search_by_key_part(self, table: str, key_part: str) -> List[dict]:
        """Search by key part with validation"""
        self._validate_identifier(table, "table name")

        try:
            with self._get_cursor(cursor_factory=RealDictCursor) as cur:
                stmt = sql.SQL("SELECT * FROM {table} WHERE id LIKE %s").format(
                    table=sql.Identifier(table),
                )
                self._execute(cur, stmt, (f"%{key_part}%",))
                return [dict(row) for row in cur.fetchall()]
        except Exception as e:
            logger.error(f"Error in search_by_key_part: {e}")
            raise

    def query_items(self, table: str, query: dict) -> List[dict]:
        """Query items with validation"""
        self._validate_identifier(table, "table name")
        
        try:
            # Validate dynamic column identifiers before building SQL.
            for field_name in query.keys():
                self._validate_identifier(field_name, f"field name '{field_name}'")

            with self._get_cursor(cursor_factory=RealDictCursor) as cur:
                base_query = sql.SQL("SELECT * FROM {}")
                statement = base_query.format(sql.Identifier(table))

                params: List[Any] = []
                if query:
                    conditions = [
                        sql.SQL("{} = %s").format(sql.Identifier(field_name))
                        for field_name in query.keys()
                    ]
                    statement = sql.SQL("{} WHERE {}").format(
                        statement,
                        sql.SQL(" AND ").join(conditions)
                    )
                    params = list(query.values())

                self._execute(cur, statement, params or None)
                return [dict(row) for row in cur.fetchall()]
        except Exception as e:
            logger.error(f"Error in query_items: {e}")
            raise

    def copy_table(self, source: str, dest: str) -> None:
        """Copy a table with transaction support"""
        # Validate table names to prevent SQL injection
        self._validate_identifier(source, "source table")
        self._validate_identifier(dest, "destination table")
        
        conn = None
        try:
            # Get connection without autocommit for transaction
            conn = self._pool.getconn()
            if not conn:
                raise OperationalError("Failed to get connection from pool")
            
            conn.autocommit = False  # Use transaction
            try:
                with conn.cursor() as cur:
                    self._execute(
                        cur,
                        sql.SQL("CREATE TABLE IF NOT EXISTS {dest} (LIKE {src} INCLUDING ALL)").format(
                            dest=sql.Identifier(dest),
                            src=sql.Identifier(source),
                        ),
                    )
                    self._execute(
                        cur,
                        sql.SQL("INSERT INTO {dest} SELECT * FROM {src}").format(
                            dest=sql.Identifier(dest),
                            src=sql.Identifier(source),
                        ),
                    )
                conn.commit()
            except Exception as e:
                conn.rollback()
                raise
            finally:
                conn.autocommit = True  # Restore autocommit
                self._pool.putconn(conn)
        except Exception as e:
            logger.error(f"Error in copy_table: {e}")
            raise

    def insert_columns(self, table: str, columns: List[str]) -> None:
        # This is a stub; actual implementation may need to alter table
        pass

    def _get_existing_columns(self, table_name: str) -> Dict[str, Dict[str, str]]:
        """Return current PostgreSQL column metadata keyed by column name."""
        with self._get_cursor(cursor_factory=RealDictCursor) as cur:
            self._execute(
                cur,
                """
                SELECT column_name, data_type, udt_name
                FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = %s
                """,
                (table_name,)
            )
            return {
                row["column_name"]: {
                    "data_type": row["data_type"],
                    "udt_name": row["udt_name"],
                }
                for row in cur.fetchall()
            }

    def _should_widen_to_bigint(self, expected_type: str, existing_column: Dict[str, str]) -> bool:
        """Return True when an existing integer column should be widened to BIGINT."""
        if expected_type != "BIGINT":
            return False

        current_data_type = (existing_column.get("data_type") or "").lower()
        current_udt_name = (existing_column.get("udt_name") or "").lower()
        return current_data_type == "integer" or current_udt_name == "int4"

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
        
        # Validate table name
        self._validate_identifier(table_name, "table name")
        
        try:
            # Get field definitions from Pydantic model
            fields = getattr(model, 'model_fields', None)
            if fields is None:
                fields = getattr(model, '__fields__', {})
            
            # Create column definitions. Types come from _get_postgres_type which
            # returns a fixed, code-controlled allowlist (TEXT, BIGINT, etc.) — wrapped
            # in sql.SQL to compose safely alongside Identifier-quoted names.
            column_defs = [
                sql.SQL("{name} {type}").format(
                    name=sql.Identifier("id"),
                    type=sql.SQL("VARCHAR(255) PRIMARY KEY"),
                )
            ]
            expected_types = {"id": "VARCHAR(255)"}

            for field_name, field_info in fields.items():
                if field_name == 'id':
                    continue

                self._validate_identifier(field_name, f"field name '{field_name}'")

                field_type = field_info.annotation if hasattr(field_info, 'annotation') else field_info
                pg_type = self._get_postgres_type(field_type)
                expected_types[field_name] = pg_type

                is_optional = False
                if hasattr(field_info, 'is_required'):
                    is_optional = not field_info.is_required()
                elif hasattr(field_info, 'default'):
                    is_optional = True
                if hasattr(field_info, 'annotation'):
                    annotation = field_info.annotation
                    if hasattr(annotation, '__origin__') and annotation.__origin__ is Union:
                        if type(None) in annotation.__args__:
                            is_optional = True

                type_clause = pg_type if is_optional else f"{pg_type} NOT NULL"
                column_defs.append(
                    sql.SQL("{name} {type}").format(
                        name=sql.Identifier(field_name),
                        type=sql.SQL(type_clause),
                    )
                )

            create_stmt = sql.SQL("CREATE TABLE IF NOT EXISTS {table} ({cols})").format(
                table=sql.Identifier(table_name),
                cols=sql.SQL(", ").join(column_defs),
            )

            with self._get_cursor() as cur:
                self._execute(cur, create_stmt)
                logger.info(f"Ensured table '{table_name}' exists for model {model.__name__}")

                existing_columns = self._get_existing_columns(table_name)

                for field_name, expected_type in expected_types.items():
                    existing_column = existing_columns.get(field_name)

                    if existing_column is None:
                        null_constraint = " NOT NULL" if field_name == "id" else ""
                        self._execute(
                            cur,
                            sql.SQL("ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col} {type}").format(
                                table=sql.Identifier(table_name),
                                col=sql.Identifier(field_name),
                                type=sql.SQL(f"{expected_type}{null_constraint}"),
                            ),
                        )
                        logger.info(
                            f"Added missing column '{field_name}' to table '{table_name}' as {expected_type}"
                        )
                        continue

                    if self._should_widen_to_bigint(expected_type, existing_column):
                        self._execute(
                            cur,
                            sql.SQL(
                                "ALTER TABLE {table} ALTER COLUMN {col} TYPE BIGINT USING {col}::BIGINT"
                            ).format(
                                table=sql.Identifier(table_name),
                                col=sql.Identifier(field_name),
                            ),
                        )
                        logger.info(
                            f"Widened column '{field_name}' on table '{table_name}' from INTEGER to BIGINT"
                        )
                
        except Exception as e:
            logger.error(f"Error ensuring table for model {model.__name__}: {e}")
            raise
    
    def _get_postgres_type(self, python_type) -> str:
        """Convert Python/Pydantic type to PostgreSQL type."""
        type_mapping = {
            str: "TEXT",
            int: "BIGINT",
            float: "DOUBLE PRECISION",
            bool: "BOOLEAN",
            dict: "JSONB",
            list: "JSONB",
            datetime.datetime: "TIMESTAMPTZ",
            datetime.date: "DATE",
            datetime.time: "TIMETZ",
        }
        
        # Handle typing annotations
        if hasattr(python_type, '__origin__'):
            origin = python_type.__origin__
            if origin is list:
                return "JSONB"
            elif origin is dict:
                return "JSONB"
            elif origin is Union:
                # For Optional types, get the non-None type
                args = [arg for arg in python_type.__args__ if arg is not type(None)]
                if args:
                    return self._get_postgres_type(args[0])
        
        # Direct type lookup
        if python_type in type_mapping:
            return type_mapping[python_type]
        
        # Default to TEXT for unknown types
        return "TEXT"

    def query(self, sql: str, params: tuple = None) -> List[dict]:
        """Execute raw SQL query with optional parameters"""
        if not sql or not sql.strip():
            raise ValueError("SQL query cannot be empty")
        
        try:
            with self._get_cursor(cursor_factory=RealDictCursor) as cur:
                self._execute(cur, sql, params if params else None)
                if cur.description:
                    return [dict(row) for row in cur.fetchall()]
                # Non-SELECT statements (DDL/DML) have no result set.
                # Return rowcount so callers can report execution outcomes.
                return [{"rowcount": cur.rowcount}]
        except Exception as e:
            logger.error(f"Error in query execution: {e}")
            logger.error(f"SQL: {sql[:200]}...")  # Log first 200 chars
            raise

    def get_binary_item(self, table: str, key: str) -> bytes:
        """Get binary item with validation"""
        self._validate_identifier(table, "table name")

        try:
            with self._get_cursor() as cur:
                stmt = sql.SQL("SELECT data FROM {table} WHERE id = %s").format(
                    table=sql.Identifier(table),
                )
                self._execute(cur, stmt, (key,))
                row = cur.fetchone()
                if row:
                    return row[0]
                raise ValueError(f'Item with key {key} not found in {table}')
        except Exception as e:
            logger.error(f"Error in get_binary_item: {e}")
            raise

    def _validate_identifier(self, identifier: str, name: str = "identifier") -> None:
        """Validate SQL identifiers to prevent injection attacks"""
        if not identifier:
            raise ValueError(f"{name} cannot be empty")
        if len(identifier) > 63:
            raise ValueError(f"{name} exceeds PostgreSQL identifier length limit (63 characters)")
        # Allow alphanumeric, underscore, and hyphen
        if not re.match(r'^[a-zA-Z0-9_-]+$', identifier):
            raise ValueError(f"{name} contains invalid characters: {identifier}")

    def list_tables(self) -> List[str]:
        """Return all table names in the current schema."""
        with self._get_cursor() as cur:
            self._execute(
                cur,
                "SELECT tablename FROM pg_tables WHERE schemaname = current_schema() ORDER BY tablename",
            )
            return [row[0] for row in cur.fetchall()]

    def __del__(self):
        """Cleanup on garbage collection"""
        try:
            self.close()
        except Exception as e:
            # Log but don't raise in __del__
            logger.error(f"Error during cleanup: {e}")
