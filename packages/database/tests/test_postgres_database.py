import os
import pytest
from unittest.mock import patch, MagicMock
from database.postgres_database import PostgresDatabase
from models.database_postgres_config import DatabasePostgresConfig

@pytest.fixture
def postgres_db():
    config = DatabasePostgresConfig(
        name="test_postgres",
        host=os.getenv("POSTGRES_HOST", "localhost"),
        port=int(os.getenv("POSTGRES_PORT", 5432)),
        user=os.getenv("POSTGRES_USER", "postgres"),
        password=os.getenv("POSTGRES_PASSWORD", "postgres"),
        database=os.getenv("POSTGRES_DB", "test_db"),
        sslmode=os.getenv("POSTGRES_SSLMODE", "prefer")
    )
    with patch("database.postgres_database.ThreadedConnectionPool") as mock_pool_class:
        # Create mock pool and connection
        mock_pool = MagicMock()
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        
        # Setup the pool to return our mock connection
        mock_pool_class.return_value = mock_pool
        mock_pool.getconn.return_value = mock_conn
        
        # Setup the connection to return our mock cursor
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_conn.autocommit = True
        
        # Setup default fetchone/fetchall for all tests
        mock_cursor.fetchone.return_value = {"id": "1", "uuid": "1", "value": "foo"}
        mock_cursor.fetchall.return_value = [
            {"id": "a", "uuid": "a"},
            {"id": "b", "uuid": "b"}
        ]
        
        db = PostgresDatabase(config)
        db._mock_pool = mock_pool
        db._mock_conn = mock_conn
        db._mock_cursor = mock_cursor
        yield db

def test_insert_and_get_item(postgres_db):
    item = {"id": "1", "uuid": "1", "value": "foo"}
    postgres_db._mock_cursor.fetchone.return_value = item
    postgres_db.insert_item("test", "1", item)
    result = postgres_db.get_item("test", "1")
    assert result["id"] == "1"
    assert result["value"] == "foo"

def test_insert_and_get_item_with_json_fields(postgres_db):
    # Arrays and dicts should be stored as JSONB
    item = {
        "id": "json1",
        "uuid": "json1",
        "tags": ["a", "b", "c"],
        "meta": {"foo": 1, "bar": [1, 2, 3]},
        "value": "foo"
    }
    postgres_db._mock_cursor.fetchone.return_value = item
    postgres_db.insert_item("test", "json1", item)
    result = postgres_db.get_item("test", "json1")
    assert result["tags"] == ["a", "b", "c"]
    assert result["meta"] == {"foo": 1, "bar": [1, 2, 3]}
    assert result["value"] == "foo"

def test_upsert_item(postgres_db):
    # First upsert
    postgres_db._mock_cursor.fetchone.return_value = {"id": "upsert1", "uuid": "upsert1", "name": "First"}
    item = {"id": "upsert1", "uuid": "upsert1", "name": "First"}
    result = postgres_db.upsert_item("test", "upsert1", item)
    assert result["id"] == "upsert1"
    # Update upsert
    postgres_db._mock_cursor.fetchone.return_value = {"id": "upsert1", "name": "Updated"}
    updated = postgres_db.upsert_item("test", "upsert1", {"id": "upsert1", "name": "Updated"})
    assert updated["name"] == "Updated"

def test_delete_item(postgres_db):
    item = {"id": "3", "uuid": "3", "value": "del"}
    postgres_db.insert_item("test", "3", item)
    postgres_db.delete_item("test", "3")
    postgres_db._mock_cursor.fetchone.return_value = None
    assert postgres_db.get_item("test", "3") is None

def test_get_all_items(postgres_db):
    postgres_db.insert_item("test", "a", {"id": "a", "uuid": "a"})
    postgres_db.insert_item("test", "b", {"id": "b", "uuid": "b"})
    postgres_db._mock_cursor.fetchall.return_value = [{"id": "a", "uuid": "a"}, {"id": "b", "uuid": "b"}]
    items = postgres_db.get_all_items("test")
    ids = {item["id"] for item in items}
    assert ids == {"a", "b"}

import datetime
from typing import Optional
from pydantic import BaseModel

def test_boolean_type_inference(postgres_db):
    """Test that boolean values are correctly inferred as BOOLEAN type, not BIGINT"""
    test_item = {
        "id": "bool_test",
        "uuid": "bool_test", 
        "name": "Test User",
        "age": 25,
        "height": 5.9,
        "is_active": True,
        "receive_email_updates": False,
        "preferences": {"theme": "dark"},
        "tags": ["user"]
    }
    
    # Test the _infer_columns method directly
    columns = postgres_db._infer_columns(test_item)
    
    # Verify boolean fields are correctly identified as BOOLEAN, not BIGINT
    assert columns["is_active"] == "BOOLEAN", f"Expected BOOLEAN, got {columns['is_active']}"
    assert columns["receive_email_updates"] == "BOOLEAN", f"Expected BOOLEAN, got {columns['receive_email_updates']}"
    
    # Verify other types are still correct
    assert columns["age"] == "BIGINT", f"Expected BIGINT, got {columns['age']}"
    assert columns["height"] == "DOUBLE PRECISION", f"Expected DOUBLE PRECISION, got {columns['height']}"
    assert columns["name"] == "TEXT", f"Expected TEXT, got {columns['name']}"
    assert columns["preferences"] == "JSONB", f"Expected JSONB, got {columns['preferences']}"
    assert columns["tags"] == "JSONB", f"Expected JSONB, got {columns['tags']}"

def test_datetime_infer_columns(postgres_db):
    """datetime.datetime values infer as TIMESTAMPTZ, not TEXT"""
    now = datetime.datetime(2024, 6, 1, 12, 0, 0, tzinfo=datetime.timezone.utc)
    item = {
        "id": "dt_test",
        "created_at": now,
        "name": "thing",
    }
    columns = postgres_db._infer_columns(item)
    assert columns["created_at"] == "TIMESTAMPTZ", f"Expected TIMESTAMPTZ, got {columns['created_at']}"
    assert columns["name"] == "TEXT"

def test_datetime_naive_infer_columns(postgres_db):
    """Naive (no tz) datetime.datetime also maps to TIMESTAMPTZ"""
    naive = datetime.datetime(2024, 1, 1, 0, 0, 0)
    columns = postgres_db._infer_columns({"id": "x", "ts": naive})
    assert columns["ts"] == "TIMESTAMPTZ"

def test_get_postgres_type_datetime(postgres_db):
    assert postgres_db._get_postgres_type(datetime.datetime) == "TIMESTAMPTZ"

def test_get_postgres_type_date(postgres_db):
    assert postgres_db._get_postgres_type(datetime.date) == "DATE"

def test_get_postgres_type_time(postgres_db):
    assert postgres_db._get_postgres_type(datetime.time) == "TIMETZ"

def test_get_postgres_type_optional_datetime(postgres_db):
    """Optional[datetime.datetime] unwraps to TIMESTAMPTZ"""
    from typing import Optional
    assert postgres_db._get_postgres_type(Optional[datetime.datetime]) == "TIMESTAMPTZ"

def test_prepare_values_datetime_passthrough(postgres_db):
    """datetime values are passed through as-is (psycopg2 handles adaptation)"""
    now = datetime.datetime(2024, 6, 1, 12, 0, 0, tzinfo=datetime.timezone.utc)
    item = {"id": "x", "created_at": now, "name": "foo"}
    values = postgres_db._prepare_values(item)
    assert values[1] is now  # not serialized to string or json
    assert isinstance(values[1], datetime.datetime)

def test_ensure_table_with_datetime_model(postgres_db):
    """ensure_table generates TIMESTAMPTZ for datetime fields in a Pydantic model"""
    class EventModel(BaseModel):
        id: str
        name: str
        occurred_at: datetime.datetime
        scheduled_for: Optional[datetime.datetime] = None

    captured_sql = []
    postgres_db._mock_cursor.execute.side_effect = lambda sql, *a, **kw: captured_sql.append(sql)
    postgres_db._mock_cursor.fetchall.return_value = []

    postgres_db.ensure_table(EventModel, "event_model")

    assert captured_sql, "No SQL was executed"
    ddl = captured_sql[0]

    # DDL is a psycopg2.sql.Composed; flatten Identifier+SQL children into a
    # single string so we can assert on the structure without needing a live
    # connection (sql.as_string requires one).
    from psycopg2 import sql as _pgsql
    def _flatten(node) -> str:
        if isinstance(node, _pgsql.Identifier):
            return '"' + '"."'.join(node.strings) + '"'
        if isinstance(node, _pgsql.SQL):
            return node.string
        if isinstance(node, _pgsql.Composed):
            return "".join(_flatten(c) for c in node.seq)
        return str(node)

    rendered = _flatten(ddl)
    assert "TIMESTAMPTZ" in rendered, f"Expected TIMESTAMPTZ in DDL:\n{rendered}"
    assert '"occurred_at" TIMESTAMPTZ NOT NULL' in rendered
    assert '"scheduled_for" TIMESTAMPTZ' in rendered
    # scheduled_for is Optional so should not have NOT NULL
    assert '"scheduled_for" TIMESTAMPTZ NOT NULL' not in rendered


def test_ensure_table_widens_existing_integer_columns_to_bigint(postgres_db):
    class LegacyJobModel(BaseModel):
        id: str
        created: int

    captured_sql = []

    def execute(sql, *args, **kwargs):
        captured_sql.append(sql)

    postgres_db._mock_cursor.execute.side_effect = execute
    postgres_db._mock_cursor.fetchall.return_value = [
        {"column_name": "id", "data_type": "character varying", "udt_name": "varchar"},
        {"column_name": "created", "data_type": "integer", "udt_name": "int4"},
    ]

    postgres_db.ensure_table(LegacyJobModel, "legacy_job")

    # SQL is now a psycopg2.sql.Composed — flatten Identifier+SQL children
    # into plain text so the assertion can match the rendered DDL.
    from psycopg2 import sql as _pgsql
    def _flatten(node) -> str:
        if isinstance(node, _pgsql.Identifier):
            return '"' + '"."'.join(node.strings) + '"'
        if isinstance(node, _pgsql.SQL):
            return node.string
        if isinstance(node, _pgsql.Composed):
            return "".join(_flatten(c) for c in node.seq)
        return str(node)

    rendered = [_flatten(s) for s in captured_sql]
    assert any(
        'ALTER TABLE "legacy_job" ALTER COLUMN "created" TYPE BIGINT USING "created"::BIGINT' in s
        for s in rendered
    ), f"Expected BIGINT widening SQL, got: {rendered}"


def test_query_items_rejects_sql_injection_field_name(postgres_db):
    """query_items should reject unsafe dynamic column names before SQL execution."""
    with pytest.raises(ValueError, match="field name"):
        postgres_db.query_items("test", {'id" OR 1=1 --': "abc"})

    postgres_db._mock_cursor.execute.assert_not_called()


def test_query_logs_rendered_sql_when_debug_enabled(postgres_db):
    postgres_db._mock_cursor.mogrify.return_value = b'SELECT * FROM "test" WHERE id = \'1\''

    with patch("database.postgres_database.logger.isEnabledFor", return_value=True), patch(
        "database.postgres_database.logger.debug"
    ) as mock_debug:
        postgres_db.query('SELECT * FROM "test" WHERE id = %s', ("1",))

    assert any(
        call.args == ("SQL: %s", 'SELECT * FROM "test" WHERE id = \'1\'')
        for call in mock_debug.call_args_list
    )
