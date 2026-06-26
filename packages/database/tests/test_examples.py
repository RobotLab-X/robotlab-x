"""
Tests for database examples module.
Tests the example usage patterns and domain services.
"""

import pytest
from datetime import datetime
from unittest.mock import Mock, MagicMock, patch
from typing import List, Optional

from database.examples import (
    BusinessCard, BusinessCardQuery, User,
    BusinessCardService, UserService,
    create_typed_adapter, create_business_card_service, create_user_service,
    example_usage, migrate_existing_service_to_typed
)
from database.interface import DatabaseAdapter


class TestBusinessCardModel:
    """Test the BusinessCard Pydantic model."""
    
    def test_business_card_creation_minimal(self):
        """Test creating a business card with minimal required fields."""
        card = BusinessCard(id="1", name="John Doe")
        assert card.id == "1"
        assert card.name == "John Doe"
        assert card.title is None
        assert card.company is None
        assert isinstance(card.created_at, datetime)
        assert isinstance(card.updated_at, datetime)
    
    def test_business_card_creation_full(self):
        """Test creating a business card with all fields."""
        now = datetime.now()
        card = BusinessCard(
            id="2",
            name="Jane Smith",
            title="CEO",
            company="Tech Corp",
            email="jane@techcorp.com",
            phone="555-0123",
            address="123 Tech St",
            website="https://techcorp.com",
            notes="Important client",
            created_at=now,
            updated_at=now
        )
        
        assert card.id == "2"
        assert card.name == "Jane Smith"
        assert card.title == "CEO"
        assert card.company == "Tech Corp"
        assert card.email == "jane@techcorp.com"
        assert card.phone == "555-0123"
        assert card.address == "123 Tech St"
        assert card.website == "https://techcorp.com"
        assert card.notes == "Important client"
        assert card.created_at == now
        assert card.updated_at == now
    
    def test_business_card_json_serialization(self):
        """Test that business card can be serialized to JSON."""
        card = BusinessCard(id="1", name="Test User")
        json_str = card.model_dump_json()
        assert '"id":"1"' in json_str
        assert '"name":"Test User"' in json_str


class TestBusinessCardQueryModel:
    """Test the BusinessCardQuery Pydantic model."""
    
    def test_business_card_query_creation_empty(self):
        """Test creating an empty query."""
        query = BusinessCardQuery()
        assert query.company is None
        assert query.email is None
        assert query.name is None
    
    def test_business_card_query_creation_partial(self):
        """Test creating a query with some fields."""
        query = BusinessCardQuery(company="Tech Corp", email="test@tech.com")
        assert query.company == "Tech Corp"
        assert query.email == "test@tech.com"
        assert query.name is None
    
    def test_business_card_query_creation_full(self):
        """Test creating a query with all fields."""
        query = BusinessCardQuery(
            company="Tech Corp",
            email="test@tech.com", 
            name="John Doe"
        )
        assert query.company == "Tech Corp"
        assert query.email == "test@tech.com"
        assert query.name == "John Doe"


class TestUserModel:
    """Test the User Pydantic model."""
    
    def test_user_creation_minimal(self):
        """Test creating a user with minimal required fields."""
        user = User(id="u1", username="testuser", email="test@example.com")
        assert user.id == "u1"
        assert user.username == "testuser"
        assert user.email == "test@example.com"
        assert user.is_active == True  # Default value
        assert isinstance(user.created_at, datetime)
    
    def test_user_creation_full(self):
        """Test creating a user with all fields."""
        now = datetime.now()
        user = User(
            id="u2",
            username="johndoe",
            email="john@example.com",
            is_active=False,
            created_at=now
        )
        
        assert user.id == "u2"
        assert user.username == "johndoe"
        assert user.email == "john@example.com"
        assert user.is_active == False
        assert user.created_at == now


class TestBusinessCardService:
    """Test the BusinessCardService domain service."""
    
    @pytest.fixture
    def mock_db(self):
        """Create a mock database adapter."""
        return Mock(spec=DatabaseAdapter)
    
    def test_business_card_service_creation(self, mock_db):
        """Test creating a business card service."""
        typed_adapter = create_typed_adapter(mock_db)
        service = BusinessCardService(typed_adapter)
        assert service._adapter == typed_adapter
        assert service._table == "business_cards"
        assert service._model_class == BusinessCard
    
    def test_business_card_service_with_typed_adapter(self, mock_db):
        """Test business card service with typed adapter."""
        typed_adapter = create_typed_adapter(mock_db)
        service = BusinessCardService(typed_adapter)
        assert service._adapter == typed_adapter


class TestUserService:
    """Test the UserService domain service."""
    
    @pytest.fixture
    def mock_db(self):
        """Create a mock database adapter."""
        return Mock(spec=DatabaseAdapter)
    
    def test_user_service_creation(self, mock_db):
        """Test creating a user service."""
        typed_adapter = create_typed_adapter(mock_db)
        service = UserService(typed_adapter)
        assert service._adapter == typed_adapter
        assert service._table == "users"
        assert service._model_class == User


class TestFactoryFunctions:
    """Test the factory functions for creating services and adapters."""
    
    @pytest.fixture
    def mock_db(self):
        """Create a mock database adapter."""
        return Mock(spec=DatabaseAdapter)
    
    def test_create_typed_adapter(self, mock_db):
        """Test creating a typed database adapter."""
        typed_adapter = create_typed_adapter(mock_db)
        
        # Should return a TypedDatabaseAdapter wrapping the original
        assert hasattr(typed_adapter, 'underlying_adapter')
        assert typed_adapter.underlying_adapter == mock_db
    
    def test_create_business_card_service(self, mock_db):
        """Test creating a business card service via factory."""
        service = create_business_card_service(mock_db)
        
        assert isinstance(service, BusinessCardService)
        assert hasattr(service, '_adapter')
    
    def test_create_user_service(self, mock_db):
        """Test creating a user service via factory."""
        service = create_user_service(mock_db)
        
        assert isinstance(service, UserService)
        assert hasattr(service, '_adapter')


class TestExampleFunctions:
    """Test the example usage functions."""
    
    @patch('database.examples.print')
    def test_example_usage(self, mock_print):
        """Test the example usage function."""
        mock_db = Mock(spec=DatabaseAdapter)
        
        # Mock the database operations
        mock_db.insert_item.return_value = {
            "id": "card-1",
            "name": "John Doe", 
            "title": "Software Engineer",
            "company": "Tech Corp",
            "email": "john@techcorp.com",
            "phone": "(555) 123-4567"
        }
        mock_db.get_item.return_value = {
            "id": "card-1",
            "name": "John Doe",
            "title": "Software Engineer", 
            "company": "Tech Corp",
            "email": "john@techcorp.com",
            "phone": "(555) 123-4567"
        }
        mock_db.update_item.return_value = {
            "id": "card-2",
            "name": "Jane Smith",
            "title": "Senior Engineer",
            "company": "Tech Corp", 
            "email": "jane@techcorp.com"
        }
        mock_db.query_items.return_value = []
        
        # Should not raise any exceptions
        example_usage(mock_db)
        
        # Verify some database operations were called
        mock_db.insert_item.assert_called()
        
        # Verify output was printed
        mock_print.assert_called()
    
    @patch('database.examples.print')
    def test_migrate_existing_service_to_typed(self, mock_print):
        """Test the migration example function."""
        mock_db = Mock(spec=DatabaseAdapter)
        
        # Mock database operations
        mock_db.get_item.return_value = {
            "id": "card-1",
            "name": "Test Card",
            "email": "test@example.com"
        }
        mock_db.query.return_value = [
            {"id": "1", "name": "Test Card", "email": "test@example.com"}
        ]
        
        # Should not raise any exceptions
        migrate_existing_service_to_typed(mock_db)
        
        # Verify output was printed
        mock_print.assert_called()


class TestModelValidation:
    """Test model validation and edge cases."""
    
    def test_business_card_invalid_email(self):
        """Test business card creation with invalid email."""
        # Note: Pydantic doesn't validate email format by default unless specified
        card = BusinessCard(id="1", name="Test", email="invalid-email")
        assert card.email == "invalid-email"
    
    def test_user_empty_username(self):
        """Test user creation with empty username."""
        # This should be allowed unless validation is added
        user = User(id="1", username="", email="test@example.com")
        assert user.username == ""
    
    def test_business_card_query_all_none(self):
        """Test query with all None values."""
        query = BusinessCardQuery()
        query_dict = query.model_dump(exclude_none=True)
        assert query_dict == {}  # Should be empty when all None
    
    def test_models_dict_conversion(self):
        """Test converting models to dictionaries."""
        card = BusinessCard(id="1", name="Test")
        card_dict = card.model_dump()
        
        assert isinstance(card_dict, dict)
        assert card_dict["id"] == "1"
        assert card_dict["name"] == "Test"
        
        user = User(id="1", username="test", email="test@example.com")
        user_dict = user.model_dump()
        
        assert isinstance(user_dict, dict)
        assert user_dict["id"] == "1"
        assert user_dict["username"] == "test"
        assert user_dict["email"] == "test@example.com"


class TestServiceIntegration:
    """Test service integration scenarios."""
    
    @pytest.fixture
    def mock_db(self):
        """Create a mock database adapter."""
        return Mock(spec=DatabaseAdapter)
    
    def test_services_use_same_database(self, mock_db):
        """Test that multiple services can share the same database."""
        business_card_service = create_business_card_service(mock_db)
        user_service = create_user_service(mock_db)
        
        # Both should reference the same underlying database through their typed adapters
        assert business_card_service._adapter.underlying_adapter == mock_db
        assert user_service._adapter.underlying_adapter == mock_db
    
    def test_typed_adapter_wraps_database(self, mock_db):
        """Test that typed adapter properly wraps database."""
        typed_adapter = create_typed_adapter(mock_db)
        
        # Should have the original database as an attribute
        assert typed_adapter.underlying_adapter == mock_db
        
        # Should be usable with services
        service = BusinessCardService(typed_adapter)
        assert service._adapter == typed_adapter
