import pytest
from database.factory import get_database, get_db
from database.tinydb import TinyDBDatabase
from database.dynamodb_database import DynamoDBDatabase
from database.filesystem_database import FilesystemDatabase
from database.s3_database import S3Database
from models.database_tinydb_config import DatabaseTinydbConfig
from models.database_dynamodb_config import DatabaseDynamodbConfig
from models.database_filesystem_config import DatabaseFilesystemConfig
from models.database_s3_config import DatabaseS3Config

class DummyDynamoDBDatabase(DynamoDBDatabase):
    def upsert_item(self, table, key, item): return {}
    def insert_item(self, table, key, item): return {}
    def get_item(self, table, key): return {}
    def get_binary_item(self, table, key): return b""
    def get_all_items(self, table): return []
    def update_item(self, table, key, updates, include_nulls: bool = False): return {}
    def delete_item(self, table, key): pass
    def query_items(self, table_name, criteria): return []
    def search_by_key_part(self, table, key_part, regex=False): return []

def make_config(database_type):
    if database_type == "tinydb":
        return lambda: DatabaseTinydbConfig(data_dir="data")
    if database_type == "dynamodb":
        return lambda: DatabaseDynamodbConfig(region_name="us-west-2", aws_access_key_id="dummy", aws_secret_access_key="dummy")
    if database_type == "s3":
        return lambda: DatabaseS3Config(
            bucket_name="dummy-bucket",
            region_name="us-west-2",
            aws_access_key_id="dummy",
            aws_secret_access_key="dummy",
        )
    if database_type == "filesystem":
        return lambda: DatabaseFilesystemConfig(database_dir="data/filesystem_db")
    if database_type == "none":
        return lambda: None
    return lambda: None

def test_get_database_tinydb():
    db = get_database(make_config("tinydb"))
    assert isinstance(db, TinyDBDatabase)

def test_get_database_dynamodb_concrete(monkeypatch):
    import database.factory
    monkeypatch.setattr(database.factory, "DynamoDBDatabase", DummyDynamoDBDatabase)
    db = database.factory.get_database(make_config("dynamodb"))
    assert isinstance(db, DummyDynamoDBDatabase)

def test_get_database_s3():
    db = get_database(make_config("s3"))
    assert isinstance(db, S3Database)

def test_get_database_filesystem():
    db = get_database(make_config("filesystem"))
    assert isinstance(db, FilesystemDatabase)

def test_get_database_none():
    db = get_database(make_config("none"))
    assert db is None

def test_get_database_unsupported():
    class UnsupportedConfig:
        pass
    with pytest.raises(ValueError):
        get_database(lambda: UnsupportedConfig())

def test_get_db_alias():
    db = get_db(make_config("tinydb"))
    assert isinstance(db, TinyDBDatabase)

# Renamed file: test_factory_database.py
