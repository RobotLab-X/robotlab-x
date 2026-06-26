import os
import shutil
import tempfile
import pytest
from database.filesystem_database import FilesystemDatabase

def make_temp_db():
    temp_dir = tempfile.mkdtemp()
    db = FilesystemDatabase({"base_dir": temp_dir})
    return db, temp_dir

@pytest.fixture
def fs_db():
    db, temp_dir = make_temp_db()
    yield db
    shutil.rmtree(temp_dir)

def test_insert_and_get_item(fs_db):
    item = {"uuid": "1", "value": "foo"}
    fs_db.insert_item("test", "1", item)
    result = fs_db.get_item("test", "1")
    assert result["uuid"] == "1"
    assert result["value"] == "foo"

def test_update_item(fs_db):
    fs_db.insert_item("test", "2", {"uuid": "2", "value": "bar"})
    updated = fs_db.update_item("test", "2", {"value": "baz"})
    assert updated["uuid"] == "2"
    assert updated["value"] == "baz"

def test_delete_item(fs_db):
    fs_db.insert_item("test", "3", {"uuid": "3", "value": "del"})
    fs_db.delete_item("test", "3")
    assert fs_db.get_item("test", "3") == {}

def test_get_all_items(fs_db):
    # Use a unique table name to avoid interference from other tests
    table_name = "test_get_all_items"
    fs_db.insert_item(table_name, "a", {"uuid": "a"})
    fs_db.insert_item(table_name, "b", {"uuid": "b"})
    items = fs_db.get_all_items(table_name)
    uuids = {item["uuid"] for item in items}
    assert uuids == {"a", "b"}

def test_search_by_key_part(fs_db):
    fs_db.insert_item("test", "abc1", {"id": "abc1"})
    fs_db.insert_item("test", "abc2", {"id": "abc2"})
    fs_db.insert_item("test", "xyz", {"id": "xyz"})
    results = fs_db.search_by_key_part("test", "abc")
    ids = {item["id"] for item in results}
    assert ids == {"abc1", "abc2"}

def test_query_items(fs_db):
    fs_db.insert_item("test", "1", {"uuid": "1", "type": "A"})
    fs_db.insert_item("test", "2", {"uuid": "2", "type": "B"})
    results = fs_db.query_items("test", {"type": "A"})
    assert len(results) == 1
    assert results[0]["uuid"] == "1"

def test_copy_table(fs_db):
    fs_db.insert_item("source", "1", {"uuid": "1", "value": "a"})
    fs_db.insert_item("source", "2", {"uuid": "2", "value": "b"})
    fs_db.insert_item("source", "3", {"uuid": "3", "value": "c"})
    fs_db.copy_table("source", "dest")
    dest_items = fs_db.get_all_items("dest")
    assert len(dest_items) == 3
    dest_uuids = {item["uuid"] for item in dest_items}
    assert dest_uuids == {"1", "2", "3"}
