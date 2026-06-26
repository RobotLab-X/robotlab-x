# managed
"""Tests for response_util module."""
import pytest
import tempfile
from pathlib import Path
from unittest.mock import Mock, patch
from fastapi.responses import FileResponse, JSONResponse
from robotlab_x.response_util import (
    build_file_response,
    build_json_response,
    build_csv_response,
    build_pdf_response
)


class TestBuildFileResponse:
    """Test build_file_response function."""

    def test_build_file_response_with_valid_file(self):
        """Test building file response with valid file."""
        with tempfile.NamedTemporaryFile(delete=False, suffix=".xlsx") as tmp:
            tmp.write(b"test content")
            tmp_path = tmp.name
        
        try:
            file_info = {
                "file_path": tmp_path,
                "file_name": "output.xlsx",
                "media_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            }
            
            response = build_file_response(file_info)
            
            assert isinstance(response, FileResponse)
            assert response.path == tmp_path
        finally:
            Path(tmp_path).unlink(missing_ok=True)

    def test_build_file_response_missing_file_path(self):
        """Test building file response with missing file_path."""
        file_info = {"file_name": "output.xlsx"}
        response = build_file_response(file_info)
        assert response is None

    def test_build_file_response_none_file_info(self):
        """Test building file response with None file_info."""
        response = build_file_response(None)
        assert response is None

    def test_build_file_response_file_not_found(self):
        """Test building file response when file doesn't exist."""
        file_info = {
            "file_path": "/nonexistent/path/file.xlsx",
            "file_name": "output.xlsx"
        }
        response = build_file_response(file_info)
        assert response is None

    def test_build_file_response_default_filename(self):
        """Test building file response uses actual filename when not specified."""
        with tempfile.NamedTemporaryFile(delete=False, suffix=".xlsx") as tmp:
            tmp.write(b"test content")
            tmp_path = tmp.name
        
        try:
            file_info = {"file_path": tmp_path}
            response = build_file_response(file_info)
            
            assert isinstance(response, FileResponse)
            # FileResponse should use the actual filename from path
        finally:
            Path(tmp_path).unlink(missing_ok=True)


class TestBuildJsonResponse:
    """Test build_json_response function."""

    def test_build_json_response_with_dict(self):
        """Test building JSON response from dictionary."""
        data = {"key": "value", "number": 42}
        response = build_json_response(data)
        
        assert isinstance(response, JSONResponse)
        assert response.status_code == 200
        # Response should have metadata and data structure
        body = response.body
        assert b"metadata" in body
        assert b"data" in body

    def test_build_json_response_with_list(self):
        """Test building JSON response from list."""
        data = [1, 2, 3, {"key": "value"}]
        response = build_json_response(data)
        
        assert isinstance(response, JSONResponse)
        import json
        body = json.loads(response.body)
        assert body["data"] == data

    def test_build_json_response_with_metadata(self):
        """Test building JSON response with custom metadata."""
        data = {"result": "success"}
        metadata = {"status": "completed", "count": 5}
        response = build_json_response(data, metadata=metadata)
        
        assert isinstance(response, JSONResponse)
        import json
        body = json.loads(response.body)
        assert body["metadata"] == metadata
        assert body["data"] == data


class TestBuildCsvResponse:
    """Test build_csv_response function."""

    def test_build_csv_response_with_valid_file(self):
        """Test building CSV response with valid file."""
        with tempfile.NamedTemporaryFile(delete=False, suffix=".csv") as tmp:
            tmp.write(b"col1,col2\nval1,val2")
            tmp_path = tmp.name
        
        try:
            file_info = {
                "file_path": tmp_path,
                "file_name": "data.csv"
            }
            
            response = build_csv_response(file_info)
            
            assert isinstance(response, FileResponse)
        finally:
            Path(tmp_path).unlink(missing_ok=True)

    def test_build_csv_response_none_file_info(self):
        """Test building CSV response with None file_info."""
        response = build_csv_response(None)
        assert response is None


class TestBuildPdfResponse:
    """Test build_pdf_response function."""

    def test_build_pdf_response_with_valid_file(self):
        """Test building PDF response with valid file."""
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
            tmp.write(b"%PDF-1.4 test content")
            tmp_path = tmp.name
        
        try:
            file_info = {
                "file_path": tmp_path,
                "file_name": "document.pdf"
            }
            
            response = build_pdf_response(file_info)
            
            assert isinstance(response, FileResponse)
        finally:
            Path(tmp_path).unlink(missing_ok=True)

    def test_build_pdf_response_none_file_info(self):
        """Test building PDF response with None file_info."""
        response = build_pdf_response(None)
        assert response is None
