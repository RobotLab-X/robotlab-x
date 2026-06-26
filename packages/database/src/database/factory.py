import logging
from typing import Dict
from typing import Dict, Optional
from .interface import DatabaseAdapter
from .interface import DatabaseAdapter
from typing import Callable, Dict
from database.interface import DatabaseAdapter
from database.tinydb import TinyDBDatabase
from database.dynamodb_database import DynamoDBDatabase
from database.filesystem_database import FilesystemDatabase
from database.s3_database import S3Database
from database.sqlite_database import SqliteDatabase
from database.mongodb_database import MongoDBDatabase
from database.postgres_database import PostgresDatabase
from models.database_sqlite_config import DatabaseSqliteConfig
from models.database_tinydb_config import DatabaseTinydbConfig
from models.database_dynamodb_config import DatabaseDynamodbConfig
from models.database_filesystem_config import DatabaseFilesystemConfig
from models.database_s3_config import DatabaseS3Config
from models.database_mongodb_config import DatabaseMongodbConfig
from models.database_postgres_config import DatabasePostgresConfig

# Singleton registry for database adapters
_clients: Dict[str, DatabaseAdapter] = {}

def create_database_client(cfg) -> None:
    name = getattr(cfg, "name", None)
    if name is None:
        raise ValueError("Config must provide a name or id")
    if name in _clients:
        logging.error(f"Database client with name '{name}' already exists and will not be replaced.")
        return None
    # Dispatch based on config type using isinstance
    if isinstance(cfg, DatabaseDynamodbConfig):
        client = DynamoDBDatabase(config=cfg)
    elif isinstance(cfg, DatabaseTinydbConfig):
        client = TinyDBDatabase(config=cfg)
    elif isinstance(cfg, DatabaseS3Config):
        client = S3Database(config=cfg)
    elif isinstance(cfg, DatabaseFilesystemConfig):
        client = FilesystemDatabase(config=cfg)
    elif isinstance(cfg, DatabaseSqliteConfig):
        client = SqliteDatabase(config=cfg)
    elif isinstance(cfg, DatabaseMongodbConfig):
        client = MongoDBDatabase(config=cfg)
    elif isinstance(cfg, DatabasePostgresConfig):
        client = PostgresDatabase(config=cfg)
    else:
        raise ValueError(f"Unsupported database config type: {type(cfg)}")
    _clients[name] = client
    return None

def get_database_client(name: str = "default") -> Optional[DatabaseAdapter]:
    return _clients.get(name)

# FIXME LIST ALL CONFIG FIELDS WHICH AFFECT THE DATABASE PACKAGE
# DATABASE_TYPES = ["dynamodb", "tinydb", "s3", "filesystem", "sqlite", "mongodb"]
# DATABASE_DIR

def get_database(config_provider: Callable[[], Dict[str, str]]) -> DatabaseAdapter:
    config = config_provider()
    # If config is a dict, use legacy dispatch
    if isinstance(config, dict):
        database_type = config.get("database_type", "").lower()
    elif config is None:
        database_type = "none"
    else:
        # Use type name for strongly typed config
        database_type = type(config).__name__.replace("Database", "").replace("Config", "").lower()

    if database_type == "dynamodb":
        return DynamoDBDatabase(config=config)
    elif database_type == "tinydb":
        return TinyDBDatabase(config=config)
    elif database_type == "s3":
        return S3Database(config=config)
    elif database_type == "filesystem":
        return FilesystemDatabase(config=config)
    elif database_type == "sqlite":
        return SqliteDatabase(config=config)
    elif database_type == "mongodb":
        return MongoDBDatabase(config=config)
    elif database_type == "postgres":
        return PostgresDatabase(config=config)
    elif database_type == "none":
        return None
    # Always raise for anything not matched above
    raise ValueError(f"Unsupported database type: {database_type}")


def get_db(config_provider: Callable[[], Dict[str, str]]) -> DatabaseAdapter:
    """
    Load database implementation dynamically based on a configuration provider.

    :param config_provider: A callable that returns the database configuration.
    :return: An instance of DatabaseAdapter.
    """
    return get_database(config_provider=config_provider)