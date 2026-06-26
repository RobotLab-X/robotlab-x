# managed
"""Tests for main module."""
import pytest
import json
import tempfile
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock
from robotlab_x.main import load_version, parse_args


class TestLoadVersion:
    """Test load_version function."""

    def test_load_version_with_valid_file(self):
        """Test loading version from valid version.json."""
        version_data = {"version": "1.2.3", "build": "abc123"}
        
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as tmp:
            json.dump(version_data, tmp)
            tmp_path = tmp.name
        
        try:
            with patch('robotlab_x.main.VERSION_FILE', tmp_path):
                version = load_version()
                assert version["version"] == "1.2.3"
                assert version["build"] == "abc123"
        finally:
            Path(tmp_path).unlink(missing_ok=True)

    def test_load_version_file_not_found(self):
        """Test loading version when file doesn't exist."""
        with patch('robotlab_x.main.VERSION_FILE', '/nonexistent/version.json'):
            version = load_version()
            assert version == {"version": "0.0.0"}

    def test_load_version_invalid_json(self):
        """Test loading version from invalid JSON."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as tmp:
            tmp.write('invalid json {')
            tmp_path = tmp.name
        
        try:
            with patch('robotlab_x.main.VERSION_FILE', tmp_path):
                version = load_version()
                assert version == {"version": "0.0.0"}
        finally:
            Path(tmp_path).unlink(missing_ok=True)


class TestParseArgs:
    """Test parse_args function."""

    @patch('sys.argv', ['robotlab_x', '--env_file', '.env.test'])
    def test_parse_args_with_env_file(self):
        """Test parsing args with custom env file."""
        args = parse_args()
        assert args.env_file == '.env.test'

    @patch('sys.argv', ['robotlab_x'])
    def test_parse_args_default_env_file(self):
        """Test parsing args with default env file."""
        args = parse_args()
        assert args.env_file == '.env'

    @patch('sys.argv', ['robotlab_x', '--env_file', '.env.prod'])
    @patch('os.path.exists')
    @patch('robotlab_x.main.logger')
    def test_parse_args_logs_existing_file(self, mock_logger, mock_exists):
        """Test that parse_args logs when env file exists."""
        mock_exists.return_value = True
        args = parse_args()
        
        # Check that info was logged about the file being found
        assert any('found' in str(call).lower() for call in mock_logger.info.call_args_list)

    @patch('sys.argv', ['robotlab_x', '--env_file', '.env.missing'])
    @patch('os.path.exists')
    @patch('robotlab_x.main.logger')
    def test_parse_args_logs_missing_file(self, mock_logger, mock_exists):
        """Test that parse_args logs warning when env file missing."""
        mock_exists.return_value = False
        args = parse_args()
        
        # Check that warning was logged about file not found
        assert any('NOT found' in str(call) for call in mock_logger.warning.call_args_list)
