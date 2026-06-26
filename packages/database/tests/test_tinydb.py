import tempfile
import shutil
import os
import pytest
from database.tinydb import TinyDBDatabase

from models.database_tinydb_config import DatabaseTinydbConfig

@pytest.fixture
def temp_db():
    temp_dir = tempfile.mkdtemp()
    config = DatabaseTinydbConfig(data_dir=temp_dir)
    db = TinyDBDatabase(config)
    yield db
    shutil.rmtree(temp_dir)

def test_insert_item(temp_db):
    item = {"uuid": "1234", "name": "TestItem"}
    result = temp_db.insert_item("test", "1234", item)
    assert result == item

def test_get_item(temp_db):
    item = {"uuid": "5678", "name": "SampleItem"}
    temp_db.insert_item("test", "5678", item)
    fetched_item = temp_db.get_item("test", "5678")
    assert fetched_item["uuid"] == "5678"
    assert fetched_item["name"] == "SampleItem"

def test_update_item(temp_db):
    item = {"uuid": "9999", "name": "OldItem"}
    temp_db.insert_item("test", "9999", item)
    updated_item = temp_db.update_item("test", "9999", {"name": "NewItem"})
    assert updated_item["uuid"] == "9999"
    assert updated_item["name"] == "NewItem"

def test_delete_item(temp_db):
    item = {"uuid": "7777", "name": "ToBeDeleted"}
    temp_db.insert_item("test", "7777", item)
    temp_db.delete_item("test", "7777")
    assert temp_db.get_item("test", "7777") == {}

def test_upsert_item_insert_and_update(temp_db):
    item = {"uuid": "upsert1", "name": "First"}
    # Insert
    result = temp_db.upsert_item("test", "upsert1", item)
    assert result["uuid"] == "upsert1"
    # Update
    updated = temp_db.upsert_item("test", "upsert1", {"name": "Updated"})
    assert updated["uuid"] == "upsert1"
    assert updated["name"] == "Updated"

def test_search_by_key_part_prefix(temp_db):
    temp_db.insert_item("test", "abc123", {"uuid": "abc123", "name": "A"})
    temp_db.insert_item("test", "abc456", {"uuid": "abc456", "name": "B"})
    temp_db.insert_item("test", "def789", {"uuid": "def789", "name": "C"})
    results = temp_db.search_by_key_part("test", "abc")
    assert len(results) == 2
    assert all(r["uuid"].startswith("abc") for r in results)

def test_search_by_key_part_regex(temp_db):
    temp_db.insert_item("test", "foo1", {"uuid": "foo1", "name": "A"})
    temp_db.insert_item("test", "bar2", {"uuid": "bar2", "name": "B"})
    temp_db.insert_item("test", "baz3", {"uuid": "baz3", "name": "C"})
    results = temp_db.search_by_key_part("test", r"ba.", regex=True)
    assert len(results) == 2
    assert set(r["uuid"] for r in results) == {"bar2", "baz3"}

def test_query_items_multiple_criteria(temp_db):
    temp_db.insert_item("test", "1", {"uuid": "1", "type": "A", "val": 10})
    temp_db.insert_item("test", "2", {"uuid": "2", "type": "A", "val": 20})
    temp_db.insert_item("test", "3", {"uuid": "3", "type": "B", "val": 10})
    results = temp_db.query_items("test", {"type": "A", "val": 10})
    assert len(results) == 1
    assert results[0]["uuid"] == "1"

def test_get_binary_item_found(temp_db):
    temp_db.insert_item("test", "bin1", {"uuid": "bin1", "data": "abc"})
    data = temp_db.get_binary_item("test", "bin1")
    assert isinstance(data, bytes)
    assert b"bin1" in data

def test_get_binary_item_not_found(temp_db):
    with pytest.raises(ValueError):
        temp_db.get_binary_item("test", "notfound")

def test_update_item_nonexistent(temp_db):
    result = temp_db.update_item("test", "nope", {"foo": "bar"})
    assert result == {}

def test_delete_item_nonexistent(temp_db):
    # Should not raise
    temp_db.delete_item("test", "nope")
    assert True

def test_get_item_nonexistent(temp_db):
    result = temp_db.get_item("test", "nope")
    assert result == {}

def test_copy_table(temp_db):
    # Clean up destination table if it exists
    temp_db.delete_item("dest", "1")
    temp_db.delete_item("dest", "2")
    temp_db.delete_item("dest", "3")
    # Insert items into source table
    temp_db.insert_item("source", "1", {"uuid": "1", "value": "a"})
    temp_db.insert_item("source", "2", {"uuid": "2", "value": "b"})
    temp_db.insert_item("source", "3", {"uuid": "3", "value": "c"})
    # Copy to destination table
    temp_db.copy_table("source", "dest")
    # All items should be present in dest
    dest_items = temp_db.get_all_items("dest")
    assert len(dest_items) == 3
    dest_uuids = {item["uuid"] for item in dest_items}
    assert dest_uuids == {"1", "2", "3"}
