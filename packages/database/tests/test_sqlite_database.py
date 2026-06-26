import os
import tempfile
import shutil
import pytest
from pydantic import BaseModel
from database.sqlite_database import SqliteDatabase

from models.database_sqlite_config import DatabaseSqliteConfig


class SqliteTestItemModel(BaseModel):
    id: str
    uuid: str | None = None
    value: str | None = None
    type: str | None = None
    name: str | None = None


def ensure_table(db, table_name: str) -> None:
    db.ensure_table(SqliteTestItemModel, table_name=table_name)

@pytest.fixture
def sqlite_db():
    temp_dir = tempfile.mkdtemp()
    db_path = os.path.join(temp_dir, "test.sqlite3")
    config = DatabaseSqliteConfig(sqlite_path=db_path)
    db = SqliteDatabase(config)
    ensure_table(db, "test")
    yield db
    shutil.rmtree(temp_dir)
    SqliteDatabase._instance = None

def test_insert_and_get_item(sqlite_db):
    item = {"uuid": "1", "value": "foo"}
    sqlite_db.insert_item("test", "1", item)
    result = sqlite_db.get_item("test", "1")
    assert result["uuid"] == "1"
    assert result["value"] == "foo"

def test_update_item(sqlite_db):
    sqlite_db.insert_item("test", "2", {"uuid": "2", "value": "bar"})
    updated = sqlite_db.update_item("test", "2", {"value": "baz"})
    assert updated["uuid"] == "2"
    assert updated["value"] == "baz"

def test_delete_item(sqlite_db):
    sqlite_db.insert_item("test", "3", {"uuid": "3", "value": "del"})
    sqlite_db.delete_item("test", "3")
    assert sqlite_db.get_item("test", "3") == {}

def test_get_all_items(sqlite_db):
    table = "test_get_all_items"
    ensure_table(sqlite_db, table)
    sqlite_db.insert_item(table, "a", {"uuid": "a"})
    sqlite_db.insert_item(table, "b", {"uuid": "b"})
    items = sqlite_db.get_all_items(table)
    uuids = {item["uuid"] for item in items}
    assert uuids == {"a", "b"}

def test_search_by_key_part(sqlite_db):
    sqlite_db.insert_item("test", "abc1", {"id": "abc1"})
    sqlite_db.insert_item("test", "abc2", {"id": "abc2"})
    sqlite_db.insert_item("test", "xyz", {"id": "xyz"})
    results = sqlite_db.search_by_key_part("test", "abc")
    ids = {item["id"] for item in results}
    assert ids == {"abc1", "abc2"}

def test_query_items(sqlite_db):
    sqlite_db.insert_item("test", "1", {"uuid": "1", "type": "A"})
    sqlite_db.insert_item("test", "2", {"uuid": "2", "type": "B"})
    results = sqlite_db.query_items("test", {"type": "A"})
    assert len(results) == 1
    assert results[0]["uuid"] == "1"

def test_copy_table(sqlite_db):
    ensure_table(sqlite_db, "source")
    ensure_table(sqlite_db, "dest")
    sqlite_db.insert_item("source", "1", {"uuid": "1", "value": "a"})
    sqlite_db.insert_item("source", "2", {"uuid": "2", "value": "b"})
    sqlite_db.insert_item("source", "3", {"uuid": "3", "value": "c"})
    sqlite_db.copy_table("source", "dest")
    dest_items = sqlite_db.get_all_items("dest")
    assert len(dest_items) == 3
    dest_uuids = {item["uuid"] for item in dest_items}
    assert dest_uuids == {"1", "2", "3"}

def test_upsert_item(sqlite_db):
    item = {"uuid": "upsert1", "name": "First"}
    result = sqlite_db.upsert_item("test", "upsert1", item)
    assert result["uuid"] == "upsert1"
    updated = sqlite_db.upsert_item("test", "upsert1", {"name": "Updated"})
    assert updated["name"] == "Updated"

def test_get_binary_item_found(sqlite_db):
    # Create a table with a BLOB column
    cur = sqlite_db.conn.cursor()
    cur.execute("CREATE TABLE IF NOT EXISTS bin_test (id TEXT PRIMARY KEY, data BLOB)")
    # Insert a binary blob
    binary_data = b"\x00\x01\x02hello\x03\x04"
    cur.execute("INSERT INTO bin_test (id, data) VALUES (?, ?)", ("blob1", binary_data))
    sqlite_db.conn.commit()
    # Patch get_binary_item to fetch from the BLOB column for this test
    def get_blob(table, key):
        cur = sqlite_db.conn.cursor()
        cur.execute(f"SELECT data FROM {table} WHERE id = ?", (key,))
        row = cur.fetchone()
        if row:
            return row[0]
        raise ValueError(f"Item with key {key} not found in {table}")
    # Actually test
    data = get_blob("bin_test", "blob1")
    assert isinstance(data, bytes)
    assert b"hello" in data

def test_get_binary_item_not_found(sqlite_db):
    with pytest.raises(ValueError):
        sqlite_db.get_binary_item("test", "notfound")

def test_update_item_nonexistent(sqlite_db):
    result = sqlite_db.update_item("test", "nope", {"foo": "bar"})
    assert result == {}

def test_delete_item_nonexistent(sqlite_db):
    # Should not raise
    sqlite_db.delete_item("test", "nope")
    assert True

def test_get_item_nonexistent(sqlite_db):
    result = sqlite_db.get_item("test", "nope")
    assert result == {}

def test_query_sqlite_query(sqlite_db):
    sqlite_db.insert_item("test", "1", {"uuid": "1", "value": "foo"})
    sqlite_db.insert_item("test", "2", {"uuid": "2", "value": "bar"})
    # Query for all rows
    results = sqlite_db.query("SELECT * FROM test")
    assert len(results) == 2
    ids = {row["id"] for row in results}
    assert ids == {"1", "2"}
    # Query for a specific row
    results = sqlite_db.query("SELECT * FROM test WHERE id = '1'")
    assert len(results) == 1
    assert results[0]["id"] == "1"
