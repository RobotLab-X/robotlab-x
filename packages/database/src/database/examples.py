"""
Example usage of the TypedDatabaseAdapter.

This file demonstrates how to use the new typed database interface
with Pydantic models for type-safe database operations.
"""

from typing import Optional, List
from pydantic import BaseModel, Field
from datetime import datetime

from .typed_interface import TypedDatabaseAdapter, DomainService
from .interface import DatabaseAdapter


# Example Pydantic models
class BusinessCard(BaseModel):
    """Example business card model."""
    id: str
    name: str
    title: Optional[str] = None
    company: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    website: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)


class BusinessCardQuery(BaseModel):
    """Query criteria for business cards."""
    company: Optional[str] = None
    email: Optional[str] = None
    name: Optional[str] = None


class User(BaseModel):
    """Example user model."""
    id: str
    username: str
    email: str
    is_active: bool = True
    created_at: datetime = Field(default_factory=datetime.now)


# Example domain service
class BusinessCardService(DomainService[BusinessCard]):
    """Typed service for business card operations."""
    
    def __init__(self, typed_adapter: TypedDatabaseAdapter):
        """Initialize with typed database adapter."""
        super().__init__(typed_adapter, "business_cards", BusinessCard)
    
    def find_by_email(self, email: str) -> List[BusinessCard]:
        """Find business cards by email."""
        return self.query_dict({"email": email})
    
    def find_by_company(self, company: str) -> List[BusinessCard]:
        """Find business cards by company."""
        return self.query_dict({"company": company})
    
    def search_by_name(self, name_part: str) -> List[BusinessCard]:
        """Search business cards by partial name."""
        return self.search_by_key(name_part)


class UserService(DomainService[User]):
    """Typed service for user operations."""
    
    def __init__(self, typed_adapter: TypedDatabaseAdapter):
        """Initialize with typed database adapter."""
        super().__init__(typed_adapter, "users", User)
    
    def find_by_username(self, username: str) -> Optional[User]:
        """Find user by username."""
        results = self.query_dict({"username": username})
        return results[0] if results else None
    
    def find_active_users(self) -> List[User]:
        """Find all active users."""
        return self.query_dict({"is_active": True})


# Factory functions for easy service creation
def create_typed_adapter(database_adapter: DatabaseAdapter) -> TypedDatabaseAdapter:
    """Create a typed database adapter."""
    return TypedDatabaseAdapter(database_adapter)


def create_business_card_service(database_adapter: DatabaseAdapter) -> BusinessCardService:
    """Create a business card service with typed operations."""
    typed_adapter = create_typed_adapter(database_adapter)
    return BusinessCardService(typed_adapter)


def create_user_service(database_adapter: DatabaseAdapter) -> UserService:
    """Create a user service with typed operations."""
    typed_adapter = create_typed_adapter(database_adapter)
    return UserService(typed_adapter)


# Example usage
def example_usage(database_adapter: DatabaseAdapter):
    """Demonstrate how to use the typed interface."""
    
    # Create typed adapter
    typed_adapter = create_typed_adapter(database_adapter)
    
    # Direct typed adapter usage
    business_card = BusinessCard(
        id="card-1",
        name="John Doe",
        title="Software Engineer",
        company="Tech Corp",
        email="john@techcorp.com",
        phone="(555) 123-4567"
    )
    
    # Insert with automatic type conversion
    saved_card = typed_adapter.insert_item("business_cards", "card-1", business_card)
    print(f"Saved: {saved_card.name} at {saved_card.company}")
    
    # Retrieve with automatic parsing
    retrieved_card = typed_adapter.get_item("business_cards", "card-1", BusinessCard)
    if retrieved_card:
        print(f"Retrieved: {retrieved_card.name}")
    
    # Query with typed criteria
    query = BusinessCardQuery(company="Tech Corp")
    results = typed_adapter.query_items("business_cards", query, BusinessCard)
    print(f"Found {len(results)} cards from Tech Corp")
    
    # Using domain services
    card_service = create_business_card_service(database_adapter)
    
    # Service operations are type-safe
    new_card = BusinessCard(
        id="card-2",
        name="Jane Smith",
        company="Tech Corp",
        email="jane@techcorp.com"
    )
    
    saved_card = card_service.create("card-2", new_card)
    company_cards = card_service.find_by_company("Tech Corp")
    print(f"Company has {len(company_cards)} cards")
    
    # Update operations
    new_card.title = "Senior Engineer"
    updated_card = card_service.update("card-2", new_card)
    print(f"Updated title: {updated_card.title}")


# Migration helper for existing services
def migrate_existing_service_to_typed(database_adapter: DatabaseAdapter):
    """
    Example of how to gradually migrate existing dict-based services to typed ones.
    """
    
    # You can still use the old interface alongside the new one
    typed_adapter = create_typed_adapter(database_adapter)
    
    # Old way (still works)
    old_data = database_adapter.get_item("business_cards", "card-1")
    if old_data:
        print(f"Old way: {old_data['name']}")
    
    # New way (type-safe)
    new_data = typed_adapter.get_item("business_cards", "card-1", BusinessCard)
    if new_data:
        print(f"New way: {new_data.name}")
        # Now you have type hints, validation, etc.
    
    # Gradual migration: convert dict to model when needed
    if old_data:
        try:
            typed_data = BusinessCard(**old_data)
            print(f"Converted: {typed_data.name}")
        except Exception as e:
            print(f"Conversion failed: {e}")
            # Handle validation errors gracefully
