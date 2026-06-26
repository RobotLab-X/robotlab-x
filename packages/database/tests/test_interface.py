import pytest
from database.interface import DatabaseAdapter

def test_abstract_methods():
    """Ensure DatabaseAdapter cannot be instantiated and enforces method implementation."""
    with pytest.raises(TypeError):
        DatabaseAdapter()  # Should fail since it's an abstract class
