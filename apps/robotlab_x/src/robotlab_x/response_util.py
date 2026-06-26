# managed
"""
Utility functions for formatting API responses.

This module provides helper functions to convert various data types
into appropriate FastAPI response objects (FileResponse, JSONResponse, etc.).
"""

import logging
from pathlib import Path
from typing import Dict, Any, Optional
from fastapi.responses import FileResponse, JSONResponse

logger = logging.getLogger(__name__)


def build_file_response(file_info: Dict[str, str]) -> Optional[FileResponse]:
    """
    Build a FileResponse from file information dictionary.
    
    Args:
        file_info: Dictionary containing:
            - file_path (str): Path to the file to return
            - file_name (str, optional): Filename to use in response. Defaults to actual filename.
            - media_type (str, optional): MIME type. Defaults to Excel spreadsheet.
    
    Returns:
        FileResponse object ready to return from endpoint, or None if file not found.
    
    Example:
        >>> file_info = {
        ...     "file_path": "/path/to/file.xlsx",
        ...     "file_name": "output.xlsx"
        ... }
        >>> response = build_file_response(file_info)
    """
    file_path = file_info.get("file_path") if file_info else None
    if not file_path:
        logger.error("File info missing file_path; cannot build FileResponse")
        return None

    path_obj = Path(file_path)
    if not path_obj.exists():
        logger.error(f"Generated file not found at {file_path}")
        return None

    filename = file_info.get("file_name") or path_obj.name
    media_type = file_info.get(
        "media_type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    
    return FileResponse(
        path=file_path,
        filename=filename,
        media_type=media_type
    )


def build_json_response(
    data: Any,
    status_code: int = 200,
    metadata: Optional[Dict[str, Any]] = None
) -> JSONResponse:
    """
    Build a standardized JSON response with optional metadata.
    
    Args:
        data: The main data payload to return
        status_code: HTTP status code (default: 200)
        metadata: Optional metadata dictionary (status, message, etc.)
    
    Returns:
        JSONResponse object with standardized structure.
    
    Example:
        >>> response = build_json_response(
        ...     data={"results": [1, 2, 3]},
        ...     metadata={"status": "success", "count": 3}
        ... )
    """
    response_body = {
        "metadata": metadata or {"status": "success"},
        "data": data
    }
    
    return JSONResponse(
        content=response_body,
        status_code=status_code
    )


def build_csv_response(file_info: Dict[str, str]) -> Optional[FileResponse]:
    """
    Build a FileResponse for CSV files.
    
    Args:
        file_info: Dictionary containing file_path and optional file_name
    
    Returns:
        FileResponse configured for CSV, or None if file not found.
    """
    if not file_info:
        return None
    
    file_info_with_type = file_info.copy()
    file_info_with_type["media_type"] = "text/csv"
    return build_file_response(file_info_with_type)


def build_pdf_response(file_info: Dict[str, str]) -> Optional[FileResponse]:
    """
    Build a FileResponse for PDF files.
    
    Args:
        file_info: Dictionary containing file_path and optional file_name
    
    Returns:
        FileResponse configured for PDF, or None if file not found.
    """
    if not file_info:
        return None
    
    file_info_with_type = file_info.copy()
    file_info_with_type["media_type"] = "application/pdf"
    return build_file_response(file_info_with_type)
