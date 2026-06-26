"""
Tests for database convert_to_flattened module.
Tests the SQLite table migration functionality.
"""

import pytest
import sqlite3
import json
import tempfile
import os
from unittest.mock import patch, MagicMock

from database.convert_to_flattened import migrate_table_to_flattened


@pytest.fixture
def temp_db():
    """Create a temporary SQLite database for testing."""
    fd, path = tempfile.mkstemp(suffix='.db')
    os.close(fd)
    
    # Create a test database with sample data
    conn = sqlite3.connect(path)
    cur = conn.cursor()
    
    # Create test table
    cur.execute("""
        CREATE TABLE test_table (
            id INTEGER PRIMARY KEY,
            json TEXT,
            existing_col TEXT
        )
    """)
    
    # Insert sample data
    test_data = [
        (1, json.dumps({"name": "John", "age": 30, "city": "NYC", "nested": {"key": "value"}}), "existing1"),
        (2, json.dumps({"name": "Jane", "age": 25, "country": "USA", "nested": {"another": "data"}}), "existing2"),
        (3, json.dumps({"name": "Bob", "age": 35, "city": "LA", "email": "bob@test.com"}), "existing3")
    ]
    
    cur.executemany("INSERT INTO test_table (id, json, existing_col) VALUES (?, ?, ?)", test_data)
    conn.commit()
    conn.close()
    
    yield path
    
    # Cleanup
    if os.path.exists(path):
        os.unlink(path)


def test_migrate_table_to_flattened_basic(temp_db):
    """Test basic migration functionality."""
    migrate_table_to_flattened(temp_db, 'test_table')
    
    # Verify the migration worked
    conn = sqlite3.connect(temp_db)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    
    # Check that new columns were added
    cur.execute("PRAGMA table_info(test_table)")
    columns = {row[1] for row in cur.fetchall()}
    
    # Should have original columns plus flattened ones
    expected_cols = {'id', 'json', 'existing_col', 'name', 'age', 'city', 'country', 'email', 'nested'}
    assert expected_cols.issubset(columns)
    
    # Check that data was migrated
    cur.execute("SELECT id, name, age, city FROM test_table WHERE id = 1")
    row = cur.fetchone()
    assert row['name'] == 'John'
    
    # Age is stored as JSON with type info
    age_data = json.loads(row['age'])
    assert age_data == {"__type__": "int", "value": 30}
    
    assert row['city'] == 'NYC'
    
    conn.close()


def test_migrate_table_to_flattened_custom_columns(temp_db):
    """Test migration with custom column names."""
    migrate_table_to_flattened(temp_db, 'test_table', json_col='json', id_col='id')
    
    conn = sqlite3.connect(temp_db)
    cur = conn.cursor()
    
    # Verify data exists
    cur.execute("SELECT COUNT(*) FROM test_table")
    count = cur.fetchone()[0]
    assert count == 3
    
    conn.close()


def test_migrate_table_to_flattened_nested_objects(temp_db):
    """Test that nested objects are properly handled."""
    migrate_table_to_flattened(temp_db, 'test_table')
    
    conn = sqlite3.connect(temp_db)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    
    # Check nested data is JSON serialized (should be already JSON from the flatten method)
    cur.execute("SELECT nested FROM test_table WHERE id = 1")
    row = cur.fetchone()
    # The nested object should be stored as JSON string
    nested_data = json.loads(row['nested'])
    assert nested_data == {"key": "value"}
    
    conn.close()


def test_migrate_table_to_flattened_existing_columns(temp_db):
    """Test that existing columns are not duplicated."""
    # Add a column that will also appear in JSON
    conn = sqlite3.connect(temp_db)
    cur = conn.cursor()
    cur.execute("ALTER TABLE test_table ADD COLUMN name TEXT")
    cur.execute("UPDATE test_table SET name = 'PreExisting' WHERE id = 1")
    conn.commit()
    conn.close()
    
    migrate_table_to_flattened(temp_db, 'test_table')
    
    # Verify no duplicate columns and original data preserved
    conn = sqlite3.connect(temp_db)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    
    cur.execute("PRAGMA table_info(test_table)")
    name_columns = [row for row in cur.fetchall() if row[1] == 'name']
    assert len(name_columns) == 1  # Only one name column
    
    conn.close()


@patch('database.convert_to_flattened.print')
def test_migrate_table_to_flattened_prints_completion(mock_print, temp_db):
    """Test that completion messages are printed."""
    migrate_table_to_flattened(temp_db, 'test_table')
    
    # Check that completion messages were printed
    mock_print.assert_any_call("Migration complete. Table 'test_table' is now flattened.")
    mock_print.assert_any_call("You may now drop the 'json' column if desired.")


def test_migrate_empty_table():
    """Test migration on empty table."""
    fd, path = tempfile.mkstemp(suffix='.db')
    os.close(fd)
    
    try:
        conn = sqlite3.connect(path)
        cur = conn.cursor()
        cur.execute("CREATE TABLE empty_table (id INTEGER PRIMARY KEY, json TEXT)")
        conn.commit()
        conn.close()
        
        # Should handle empty table gracefully
        migrate_table_to_flattened(path, 'empty_table')
        
        # Verify table structure unchanged
        conn = sqlite3.connect(path)
        cur = conn.cursor()
        cur.execute("PRAGMA table_info(empty_table)")
        columns = [row[1] for row in cur.fetchall()]
        assert set(columns) == {'id', 'json'}
        conn.close()
        
    finally:
        if os.path.exists(path):
            os.unlink(path)


def test_migrate_with_invalid_json():
    """Test handling of invalid JSON data."""
    fd, path = tempfile.mkstemp(suffix='.db')
    os.close(fd)
    
    try:
        conn = sqlite3.connect(path)
        cur = conn.cursor()
        cur.execute("CREATE TABLE invalid_json_table (id INTEGER PRIMARY KEY, json TEXT)")
        cur.execute("INSERT INTO invalid_json_table (id, json) VALUES (1, 'invalid json')")
        conn.commit()
        conn.close()
        
        # Should raise an error for invalid JSON
        with pytest.raises(json.JSONDecodeError):
            migrate_table_to_flattened(path, 'invalid_json_table')
            
    finally:
        if os.path.exists(path):
            os.unlink(path)
