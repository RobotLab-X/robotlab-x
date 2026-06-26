import os
import pytest
from database.tinydb import TinyDBDatabase

@pytest.fixture
def temp_db():
    """Creates a temporary database for testing."""
    db_file = "test_db.json"
    config = {"data_dir": "."}  # Use current directory for test DB
    db = TinyDBDatabase(config)
    yield db
    # Clean up test DB file(s)
    db_path = os.path.join(config["data_dir"], "databases", db_file)
    if os.path.exists(db_path):
        os.remove(db_path)
