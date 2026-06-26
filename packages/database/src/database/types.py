"""
Database type utilities for Pydantic models.

Provides custom types for better interoperability between Python models
and database systems, particularly MongoDB.
"""
from pydantic import BeforeValidator
from typing import Optional, Union, Annotated, Dict, Any, List
from datetime import datetime

try:
    from bson import ObjectId
    BSON_AVAILABLE = True
except ImportError:
    BSON_AVAILABLE = False


def convert_datetime_to_string(v: Union[str, datetime, None]) -> Optional[str]:
    """
    Convert datetime objects to ISO format strings.
    
    This is particularly useful for MongoDB compatibility, where datetime objects
    from the database need to be converted to strings for Pydantic models.
    
    Args:
        v: Value that may be a datetime object, string, or None
        
    Returns:
        ISO format string if input is datetime, original string if already string, None if None
        
    Example:
        >>> from datetime import datetime
        >>> convert_datetime_to_string(datetime(2023, 1, 1, 12, 0, 0))
        '2023-01-01T12:00:00'
        >>> convert_datetime_to_string("2023-01-01T12:00:00")
        '2023-01-01T12:00:00'
        >>> convert_datetime_to_string(None)
        None
    """
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.isoformat()
    return v


# Custom type for datetime fields that auto-convert to strings
# Use this for Pydantic model fields that need to accept datetime objects
# from databases (like MongoDB) but store/serialize as ISO strings
DateTimeStr = Annotated[Optional[str], BeforeValidator(convert_datetime_to_string)]
"""
Type annotation for datetime fields that auto-convert to ISO strings.

This type accepts:
- datetime objects (converts to ISO string)
- ISO format strings (passes through)
- None (passes through)

Example usage in a Pydantic model:
    ```python
    from pydantic import BaseModel, Field
    from database.types import DateTimeStr
    
    class MyModel(BaseModel):
        created_at: DateTimeStr = Field(None, json_schema_extra={"example": "2023-01-01T00:00:00Z"})
        updated_at: DateTimeStr = Field(None, json_schema_extra={"example": "2023-01-01T00:00:00Z"})
    ```
"""


def convert_objectid_to_str(doc: Union[Dict[str, Any], List, Any]) -> Union[Dict[str, Any], List, Any]:
    """
    Convert MongoDB ObjectId fields to strings for JSON serialization.
    
    Recursively processes dictionaries, lists, and nested structures to convert
    all BSON ObjectId instances to strings. This is essential for serializing
    MongoDB documents to JSON/Pydantic models.
    
    Args:
        doc: Document, list, or value that may contain ObjectId instances
        
    Returns:
        Same structure with all ObjectId instances converted to strings
        
    Example:
        >>> from bson import ObjectId
        >>> doc = {"_id": ObjectId("507f1f77bcf86cd799439011"), "name": "test"}
        >>> convert_objectid_to_str(doc)
        {"_id": "507f1f77bcf86cd799439011", "name": "test"}
        
        >>> docs = [{"_id": ObjectId("507f1f77bcf86cd799439011")}]
        >>> convert_objectid_to_str(docs)
        [{"_id": "507f1f77bcf86cd799439011"}]
    """
    if not BSON_AVAILABLE:
        return doc
        
    if doc is None:
        return None
    
    # Handle ObjectId directly
    if isinstance(doc, ObjectId):
        return str(doc)
    
    # Handle dictionaries
    if isinstance(doc, dict):
        result = {}
        for key, value in doc.items():
            if isinstance(value, ObjectId):
                result[key] = str(value)
            elif isinstance(value, (dict, list)):
                result[key] = convert_objectid_to_str(value)
            else:
                result[key] = value
        return result
    
    # Handle lists
    if isinstance(doc, list):
        return [convert_objectid_to_str(item) for item in doc]
    
    # Return other types as-is
    return doc
