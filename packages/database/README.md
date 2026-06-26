# Database - Database Package

> **Parent**: [packages](../README.md) · **Repo root**: [Repo Root](../../README.md)

This is the `database` Python library for the Cloudseeder monorepo.

## Overview
This package provides a unified, type-safe interface for working with multiple database backends, including:
- SQLite
- TinyDB
- DynamoDB
- S3
- Filesystem
- MongoDB

It supports basic CRUD operations, table management, and searching/querying records. The package uses config models to select and configure the backend, and provides a singleton registry for database clients.

## Common Usage

### Register and Retrieve a Database Client
```python
from database.factory import create_database_client, get_database_client
from models.database_sqlite_config import DatabaseSqliteConfig

cfg = DatabaseSqliteConfig(sqlite_path="mydb.sqlite3", name="main")
create_database_client(cfg)
db = get_database_client("main")
```

### Insert, Get, Update, and Delete Items
```python
db.insert_item("users", "user1", {"uuid": "user1", "name": "Alice"})
user = db.get_item("users", "user1")
db.update_item("users", "user1", {"name": "Bob"})
db.delete_item("users", "user1")
```

### Query and Search
```python
results = db.query_items("users", {"type": "admin"})
for user in results:
    print(user)

matches = db.search_by_key_part("users", "abc")
```

### Get All Items
```python
all_users = db.get_all_items("users")
```

### Use with Other Backends
```python
from models.database_tinydb_config import DatabaseTinydbConfig
cfg = DatabaseTinydbConfig(data_dir="/tmp", name="testdb")
create_database_client(cfg)
db = get_database_client("testdb")
```

## Developer Notes
- Use the provided config models to select and configure your backend.
- All database operations are available via the unified adapter interface.
- See the `/tests` folder for real-world usage and integration examples.
- For advanced features (copy table, search by key part, migrations), see the source code and tests.

---
For questions or contributions, open an issue or pull request in the Cloudseeder repository.
