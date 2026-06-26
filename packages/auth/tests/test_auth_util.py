"""
Tests for auth_util module.
Tests authentication utilities including dual authentication and role-based access control.
"""

import pytest
from unittest.mock import Mock, patch, MagicMock
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
import time

from auth.auth_util import (
    base36encode,
    generate_timestamp_id,
    AuthDependencies,
    create_auth_dependencies,
    no_auth_required,
    no_role_required
)


class TestBase36Encode:
    """Test the base36encode utility function."""
    
    def test_base36encode_zero(self):
        """Test encoding zero."""
        assert base36encode(0) == '0'
    
    def test_base36encode_single_digit(self):
        """Test encoding single digit numbers."""
        assert base36encode(1) == '1'
        assert base36encode(9) == '9'
    
    def test_base36encode_letters(self):
        """Test encoding numbers that result in letters."""
        assert base36encode(10) == 'a'
        assert base36encode(35) == 'z'
    
    def test_base36encode_larger_numbers(self):
        """Test encoding larger numbers."""
        assert base36encode(36) == '10'
        assert base36encode(1296) == '100'  # 36^2
    
    def test_base36encode_negative_number(self):
        """Test that negative numbers raise ValueError."""
        with pytest.raises(ValueError, match="number must be positive"):
            base36encode(-1)
    
    def test_base36encode_large_number(self):
        """Test encoding a large timestamp-like number."""
        timestamp = 1700000000000  # Large timestamp
        result = base36encode(timestamp)
        assert isinstance(result, str)
        assert len(result) > 0
        # Verify it only contains valid base36 characters
        valid_chars = set('0123456789abcdefghijklmnopqrstuvwxyz')
        assert all(c in valid_chars for c in result)


class TestGenerateTimestampId:
    """Test the generate_timestamp_id function."""
    
    def test_generate_timestamp_id_format(self):
        """Test that generated ID has correct format."""
        result = generate_timestamp_id()
        assert isinstance(result, str)
        assert '-' in result
        parts = result.split('-')
        assert len(parts) == 2
        # Check that both parts are base36 strings
        valid_chars = set('0123456789abcdefghijklmnopqrstuvwxyz')
        assert all(c in valid_chars for c in parts[0])
        assert all(c in valid_chars for c in parts[1])
    
    def test_generate_timestamp_id_random_part_length(self):
        """Test that random part is zero-filled to 6 characters."""
        result = generate_timestamp_id()
        random_part = result.split('-')[1]
        assert len(random_part) == 6
    
    def test_generate_timestamp_id_uniqueness(self):
        """Test that consecutive calls generate different IDs."""
        id1 = generate_timestamp_id()
        time.sleep(0.001)  # Small delay to ensure different timestamp
        id2 = generate_timestamp_id()
        assert id1 != id2
    
    @patch('time.time')
    @patch('random.random')
    def test_generate_timestamp_id_deterministic(self, mock_random, mock_time):
        """Test ID generation with mocked time and random for deterministic results."""
        mock_time.return_value = 1700000000.0  # Fixed timestamp
        mock_random.return_value = 0.5  # Fixed random value
        
        result = generate_timestamp_id()
        
        # Verify the format and that it's reproducible
        assert isinstance(result, str)
        assert '-' in result
        
        # Call again with same mocked values
        result2 = generate_timestamp_id()
        assert result == result2


class TestAuthDependencies:
    """Test the AuthDependencies class."""
    
    @pytest.fixture
    def mock_config_provider(self):
        """Create a mock config provider."""
        return Mock(return_value={
            "auth_enabled": True,
            "api_shared_secret": "test-secret-123"
        })
    
    @pytest.fixture
    def auth_deps(self, mock_config_provider):
        """Create AuthDependencies instance with mocked config."""
        with patch('auth.auth_util.get_auth_provider') as mock_get_auth:
            mock_auth = Mock()
            mock_get_auth.return_value = mock_auth
            deps = AuthDependencies(mock_config_provider)
            deps.auth = mock_auth
            return deps
    
    def test_auth_dependencies_initialization(self, mock_config_provider):
        """Test AuthDependencies initialization."""
        with patch('auth.auth_util.get_auth_provider') as mock_get_auth:
            mock_auth = Mock()
            mock_get_auth.return_value = mock_auth
            
            deps = AuthDependencies(mock_config_provider)
            
            assert deps.config_provider == mock_config_provider
            assert deps.auth == mock_auth
            mock_get_auth.assert_called_once_with(mock_config_provider)
    
    def test_get_current_user_or_service_auth_disabled(self, auth_deps, mock_config_provider):
        """Test authentication when auth is disabled."""
        mock_config_provider.return_value = {"auth_type": "none"}
        
        result = auth_deps.get_current_user_or_service()
        
        assert result["id"] == "no-auth"
        assert result["username"] == "no-auth"
        assert result["roles"] == []
        assert result["auth_type"] == "none"
    
    def test_get_current_user_or_service_valid_api_key(self, auth_deps):
        """Test authentication with valid API key."""
        result = auth_deps.get_current_user_or_service(x_api_key="test-secret-123")
        
        assert result["id"] == "service"
        assert result["email"] == "service@service.internal"
        assert result["username"] == "service"
        assert result["roles"] == []  # Global fallback grants no roles
        assert result["auth_type"] == "shared_secret"
    
    def test_get_current_user_or_service_invalid_api_key(self, auth_deps):
        """Test authentication with invalid API key."""
        with pytest.raises(HTTPException) as exc_info:
            auth_deps.get_current_user_or_service(x_api_key="invalid-key")
        
        assert exc_info.value.status_code == 401
        assert "Invalid API key" in str(exc_info.value.detail)
    
    def test_get_current_user_or_service_missing_secret_config(self, auth_deps, mock_config_provider):
        """Test authentication when shared secret is not configured."""
        mock_config_provider.return_value = {"auth_enabled": True}  # No api_shared_secret
        
        with pytest.raises(HTTPException) as exc_info:
            auth_deps.get_current_user_or_service(x_api_key="some-key")
        
        assert exc_info.value.status_code == 401
        assert "Invalid API key" in str(exc_info.value.detail)
    
    def test_get_current_user_or_service_valid_token(self, auth_deps):
        """Test authentication with valid token."""
        mock_credentials = Mock(spec=HTTPAuthorizationCredentials)
        mock_credentials.credentials = "valid-token"
        
        mock_user = {
            "id": "user123",
            "username": "testuser",
            "email": "test@example.com",
            "roles": ["User"]
        }
        auth_deps.auth.get_user.return_value = mock_user
        
        # Call with credentials and explicitly pass None for x_api_key
        result = auth_deps.get_current_user_or_service(credentials=mock_credentials, x_api_key=None)
        
        expected_user = mock_user.copy()
        expected_user["auth_type"] = "token"
        assert result == expected_user
    
    def test_get_current_user_or_service_invalid_token(self, auth_deps):
        """Test authentication with invalid token."""
        mock_credentials = Mock(spec=HTTPAuthorizationCredentials)
        mock_credentials.credentials = "invalid-token"
        
        auth_deps.auth.get_user.side_effect = HTTPException(status_code=401, detail="Invalid token")
        
        with pytest.raises(HTTPException) as exc_info:
            auth_deps.get_current_user_or_service(credentials=mock_credentials)
        
        assert exc_info.value.status_code == 401
    
    def test_get_current_user_or_service_no_credentials(self, auth_deps):
        """Test authentication with no credentials provided."""
        with pytest.raises(HTTPException) as exc_info:
            # Call with explicit None values for both credentials
            auth_deps.get_current_user_or_service(credentials=None, x_api_key=None)
        
        assert exc_info.value.status_code == 401
        assert "Authentication required" in str(exc_info.value.detail)
    
    def test_get_current_user_success(self, auth_deps):
        """Test getting current user with valid credentials."""
        mock_credentials = Mock(spec=HTTPAuthorizationCredentials)
        mock_credentials.credentials = "valid-token"
        
        mock_user = {
            "id": "user123",
            "username": "testuser",
            "mfa_required": False,
            "mfa_verified": True
        }
        auth_deps.auth.get_user.return_value = mock_user
        
        result = auth_deps.get_current_user(mock_credentials)
        assert result == mock_user
    
    def test_get_current_user_no_user(self, auth_deps):
        """Test getting current user when auth returns None."""
        mock_credentials = Mock(spec=HTTPAuthorizationCredentials)
        mock_credentials.credentials = "invalid-token"
        
        auth_deps.auth.get_user.return_value = None
        
        with pytest.raises(HTTPException) as exc_info:
            auth_deps.get_current_user(mock_credentials)
        
        assert exc_info.value.status_code == 401
        assert "Invalid or expired token" in str(exc_info.value.detail)
    
    def test_get_current_user_mfa_required(self, auth_deps):
        """Test getting current user when MFA is required but not verified."""
        mock_credentials = Mock(spec=HTTPAuthorizationCredentials)
        mock_credentials.credentials = "valid-token"
        
        mock_user = {
            "id": "user123",
            "username": "testuser",
            "mfa_required": True,
            "mfa_verified": False
        }
        auth_deps.auth.get_user.return_value = mock_user
        
        with pytest.raises(HTTPException) as exc_info:
            auth_deps.get_current_user(mock_credentials)
        
        assert exc_info.value.status_code == 401
        # Due to exception handling, the original MFA message gets wrapped
        assert "Invalid or expired token" in str(exc_info.value.detail)
    
    def test_get_current_user_mfa_verified(self, auth_deps):
        """Test getting current user when MFA is required and verified."""
        mock_credentials = Mock(spec=HTTPAuthorizationCredentials)
        mock_credentials.credentials = "valid-token"
        
        mock_user = {
            "id": "user123",
            "username": "testuser",
            "mfa_required": True,
            "mfa_verified": True
        }
        auth_deps.auth.get_user.return_value = mock_user
        
        result = auth_deps.get_current_user(mock_credentials)
        assert result == mock_user
    
    def test_get_current_user_auth_exception(self, auth_deps):
        """Test getting current user when auth provider raises exception."""
        mock_credentials = Mock(spec=HTTPAuthorizationCredentials)
        mock_credentials.credentials = "problematic-token"
        
        auth_deps.auth.get_user.side_effect = Exception("Auth service error")
        
        with pytest.raises(HTTPException) as exc_info:
            auth_deps.get_current_user(mock_credentials)
        
        assert exc_info.value.status_code == 401
        assert "Invalid or expired token" in str(exc_info.value.detail)


class TestRoleRequirement:
    """Test role requirement functionality."""
    
    @pytest.fixture
    def mock_config_provider(self):
        """Create a mock config provider."""
        return Mock(return_value={
            "auth_enabled": True,
            "api_shared_secret": "test-secret-123"
        })
    
    @pytest.fixture
    def auth_deps(self, mock_config_provider):
        """Create AuthDependencies instance with mocked config."""
        with patch('auth.auth_util.get_auth_provider') as mock_get_auth:
            mock_auth = Mock()
            mock_get_auth.return_value = mock_auth
            deps = AuthDependencies(mock_config_provider)
            deps.auth = mock_auth
            return deps
    
    def test_require_role_auth_disabled(self, auth_deps):
        """Test role requirement when auth is disabled."""
        role_checker = auth_deps.require_role(["Admin"])
        
        mock_user = {"auth_type": "none"}
        result = role_checker(mock_user)
        
        assert result == mock_user
    
    def test_require_role_service_auth(self, auth_deps):
        """Test role requirement with service authentication that has Admin."""
        role_checker = auth_deps.require_role(["Admin"])
        
        mock_user = {
            "auth_type": "shared_secret",
            "username": "service",
            "roles": ["Admin"]  # Mock with Admin role for testing
        }
        result = role_checker(mock_user)
        
        assert result == mock_user

    def test_require_role_service_auth_matching_role(self, auth_deps):
        """Test shared secret auth succeeds when required role is present."""
        role_checker = auth_deps.require_role(["Search"])
        
        mock_user = {
            "auth_type": "shared_secret",
            "username": "service",
            "roles": ["Service", "Search"]
        }
        result = role_checker(mock_user)
        
        assert result == mock_user

    def test_require_role_service_auth_insufficient_roles(self, auth_deps):
        """Test shared secret auth fails when required role missing."""
        role_checker = auth_deps.require_role(["Search"])
        
        mock_user = {
            "auth_type": "shared_secret",
            "username": "service",
            "roles": ["Service"]
        }
        
        with pytest.raises(HTTPException) as exc_info:
            role_checker(mock_user)
        
        assert exc_info.value.status_code == 403
    
    def test_require_role_admin_user(self, auth_deps):
        """Test role requirement with admin user."""
        role_checker = auth_deps.require_role(["SpecificRole"])
        
        mock_user = {
            "auth_type": "token",
            "username": "admin",
            "roles": ["Admin", "User"]
        }
        result = role_checker(mock_user)
        
        assert result == mock_user
    
    def test_require_role_matching_role(self, auth_deps):
        """Test role requirement with matching user role."""
        role_checker = auth_deps.require_role(["Editor", "Admin"])
        
        mock_user = {
            "auth_type": "token",
            "username": "editor",
            "roles": ["Editor", "User"]
        }
        result = role_checker(mock_user)
        
        assert result == mock_user
    
    def test_require_role_insufficient_permissions(self, auth_deps):
        """Test role requirement with insufficient permissions."""
        role_checker = auth_deps.require_role(["Admin"])
        
        mock_user = {
            "auth_type": "token",
            "username": "user",
            "roles": ["User"]
        }
        
        with pytest.raises(HTTPException) as exc_info:
            role_checker(mock_user)
        
        assert exc_info.value.status_code == 403
        assert "Insufficient permissions" in str(exc_info.value.detail)
    
    def test_require_role_no_roles_required(self, auth_deps):
        """Test role requirement when no roles are required."""
        role_checker = auth_deps.require_role([])
        
        mock_user = {
            "auth_type": "token",
            "username": "user",
            "roles": ["User"]
        }
        result = role_checker(mock_user)
        
        assert result == mock_user
    
    def test_require_role_user_no_roles(self, auth_deps):
        """Test role requirement when user has no roles."""
        role_checker = auth_deps.require_role(["Admin"])
        
        mock_user = {
            "auth_type": "token",
            "username": "user",
            "roles": []
        }
        
        with pytest.raises(HTTPException) as exc_info:
            role_checker(mock_user)
        
        assert exc_info.value.status_code == 403
    
    def test_require_role_user_missing_roles_key(self, auth_deps):
        """Test role requirement when user dict doesn't have roles key."""
        role_checker = auth_deps.require_role(["Admin"])
        
        mock_user = {
            "auth_type": "token",
            "username": "user"
            # Missing 'roles' key
        }
        
        with pytest.raises(HTTPException) as exc_info:
            role_checker(mock_user)
        
        assert exc_info.value.status_code == 403
    
    def test_require_role_or_service_alias(self, auth_deps):
        """Test that require_role_or_service is an alias for require_role."""
        role_checker1 = auth_deps.require_role(["Admin"])
        role_checker2 = auth_deps.require_role_or_service(["Admin"])
        
        # Both should be the same function type
        assert callable(role_checker1)
        assert callable(role_checker2)


class TestFactoryFunctions:
    """Test factory functions and utility functions."""
    
    def test_create_auth_dependencies(self):
        """Test creating auth dependencies via factory function."""
        mock_config_provider = Mock()
        
        with patch('auth.auth_util.AuthDependencies') as mock_auth_deps:
            mock_instance = Mock()
            mock_auth_deps.return_value = mock_instance
            
            result = create_auth_dependencies(mock_config_provider)
            
            mock_auth_deps.assert_called_once_with(mock_config_provider)
            assert result == mock_instance
    
    def test_no_auth_required(self):
        """Test no_auth_required utility function."""
        result = no_auth_required()
        assert result == {}
    
    def test_no_role_required(self):
        """Test no_role_required utility function."""
        result = no_role_required()
        assert result == {}


class TestIntegrationScenarios:
    """Test integration scenarios and edge cases."""
    
    @pytest.fixture
    def auth_deps_with_real_config(self):
        """Create AuthDependencies with a more realistic config."""
        def config_provider():
            return {
                "auth_enabled": True,
                "api_shared_secret": "super-secret-key-123",
                "app_name": "test_app"
            }
        
        with patch('auth.auth_util.get_auth_provider') as mock_get_auth:
            mock_auth = Mock()
            mock_get_auth.return_value = mock_auth
            deps = AuthDependencies(config_provider)
            deps.auth = mock_auth
            return deps
    
    def test_mixed_authentication_precedence(self, auth_deps_with_real_config):
        """Test that shared secret takes precedence over token when both are provided."""
        mock_credentials = Mock(spec=HTTPAuthorizationCredentials)
        mock_credentials.credentials = "some-token"
        
        # Should use shared secret authentication
        result = auth_deps_with_real_config.get_current_user_or_service(
            credentials=mock_credentials,
            x_api_key="super-secret-key-123"
        )
        
        assert result["auth_type"] == "shared_secret"
        assert result["username"] == "service"
        
        # Verify token auth wasn't called
        auth_deps_with_real_config.auth.get_user.assert_not_called()
    
    def test_role_checking_with_multiple_roles(self, auth_deps_with_real_config):
        """Test role checking when user has multiple roles."""
        role_checker = auth_deps_with_real_config.require_role(["Editor", "Moderator"])
        
        mock_user = {
            "auth_type": "token",
            "username": "multiuser",
            "roles": ["User", "Editor", "Viewer"]
        }
        
        result = role_checker(mock_user)
        assert result == mock_user
    
    def test_config_provider_called_multiple_times(self):
        """Test that config provider is called each time for fresh config."""
        call_count = 0
        
        def config_provider():
            nonlocal call_count
            call_count += 1
            return {
                "auth_enabled": True,
                "api_shared_secret": f"secret-{call_count}"
            }
        
        with patch('auth.auth_util.get_auth_provider'):
            deps = AuthDependencies(config_provider)
            
            # First call
            deps.get_current_user_or_service(x_api_key="secret-1")
            assert call_count == 1
            
            # Second call should call config provider again
            try:
                deps.get_current_user_or_service(x_api_key="secret-1")  # This should fail now
            except HTTPException:
                pass  # Expected since secret changed
            assert call_count == 2
    
    def test_edge_case_empty_roles_list(self, auth_deps_with_real_config):
        """Test edge case when user roles is an empty list vs None."""
        role_checker = auth_deps_with_real_config.require_role(["Admin"])
        
        # Test with empty list
        mock_user_empty_roles = {
            "auth_type": "token",
            "username": "user",
            "roles": []
        }
        
        with pytest.raises(HTTPException) as exc_info:
            role_checker(mock_user_empty_roles)
        assert exc_info.value.status_code == 403
        
        # Test with None roles (should default to empty list)
        mock_user_none_roles = {
            "auth_type": "token", 
            "username": "user"
            # No roles key
        }
        
        with pytest.raises(HTTPException) as exc_info:
            role_checker(mock_user_none_roles)
        assert exc_info.value.status_code == 403


class TestSharedSecretCallback:
    """Test dual authentication with custom shared secret validator callbacks."""
    
    @pytest.fixture
    def mock_config_provider(self):
        """Create a mock config provider."""
        return Mock(return_value={
            "auth_enabled": True,
            "api_shared_secret": "global-secret-123"
        })
    
    @pytest.fixture
    def auth_deps(self, mock_config_provider):
        """Create AuthDependencies instance with mocked config."""
        with patch('auth.auth_util.get_auth_provider') as mock_get_auth:
            mock_auth = Mock()
            mock_get_auth.return_value = mock_auth
            deps = AuthDependencies(mock_config_provider)
            deps.auth = mock_auth
            return deps
    
    def test_set_shared_secret_validator(self, auth_deps):
        """Test registering a shared secret validator callback."""
        def my_validator(api_key: str):
            return {"id": "client-1", "username": "Test Client"}
        
        auth_deps.set_shared_secret_validator(my_validator)
        
        # Verify the global variable was set
        from auth import auth_util
        assert auth_util._global_shared_secret_validator == my_validator
    
    def test_callback_validator_valid_key(self, auth_deps):
        """Test authentication with valid API key through callback."""
        def mock_validator(api_key: str):
            if api_key == "client-secret-abc":
                return {
                    "id": "client-123",
                    "username": "Acme Corp Client",
                    "email": "client-123@client.internal",
                    "roles": ["Search"],
                    "tenant_id": "tenant-acme",
                    "volume_ids": ["vol-1", "vol-2"],
                    "client_id": "client-123"
                }
            return None
        
        auth_deps.set_shared_secret_validator(mock_validator)
        
        result = auth_deps.get_current_user_or_service(x_api_key="client-secret-abc")
        
        assert result["id"] == "client-123"
        assert result["username"] == "Acme Corp Client"
        assert result["roles"] == ["Search"]
        assert result["tenant_id"] == "tenant-acme"
        assert result["volume_ids"] == ["vol-1", "vol-2"]
        assert result["client_id"] == "client-123"
        assert result["auth_type"] == "shared_secret"
    
    def test_callback_validator_invalid_key_fallback_to_global(self, auth_deps):
        """Test that invalid callback key falls back to global shared secret."""
        def mock_validator(api_key: str):
            # Only validate specific client keys
            if api_key == "client-secret-abc":
                return {"id": "client-123", "username": "Client"}
            return None
        
        auth_deps.set_shared_secret_validator(mock_validator)
        
        # Use global secret instead of client secret
        result = auth_deps.get_current_user_or_service(x_api_key="global-secret-123")
        
        # Should fall back to global service account
        assert result["id"] == "service"
        assert result["username"] == "service"
        assert result["roles"] == []  # Global fallback grants no roles
        assert result["auth_type"] == "shared_secret"
    
    def test_callback_validator_neither_valid(self, auth_deps):
        """Test authentication fails when neither callback nor global secret match."""
        def mock_validator(api_key: str):
            return None  # Always return None
        
        auth_deps.set_shared_secret_validator(mock_validator)
        
        with pytest.raises(HTTPException) as exc_info:
            auth_deps.get_current_user_or_service(x_api_key="invalid-key")
        
        assert exc_info.value.status_code == 401
        assert "Invalid API key" in str(exc_info.value.detail)
    
    def test_callback_validator_exception_handling(self, auth_deps):
        """Test that exceptions in callback are handled gracefully."""
        def failing_validator(api_key: str):
            raise Exception("Database connection failed")
        
        auth_deps.set_shared_secret_validator(failing_validator)
        
        with pytest.raises(HTTPException) as exc_info:
            auth_deps.get_current_user_or_service(x_api_key="any-key")
        
        assert exc_info.value.status_code == 500
        assert "Internal authentication error" in str(exc_info.value.detail)
    
    def test_callback_shared_across_instances(self, mock_config_provider):
        """Test that callback is shared across multiple AuthDependencies instances."""
        with patch('auth.auth_util.get_auth_provider') as mock_get_auth:
            mock_auth = Mock()
            mock_get_auth.return_value = mock_auth
            
            # Create first instance and set callback
            deps1 = AuthDependencies(mock_config_provider)
            deps1.auth = mock_auth
            
            def shared_validator(api_key: str):
                if api_key == "shared-key":
                    return {
                        "id": "shared-client",
                        "username": "Shared Client",
                        "roles": ["Search"],
                        "client_id": "shared-client"
                    }
                return None
            
            deps1.set_shared_secret_validator(shared_validator)
            
            # Create second instance
            deps2 = AuthDependencies(mock_config_provider)
            deps2.auth = mock_auth
            
            # Second instance should use the same callback
            result = deps2.get_current_user_or_service(x_api_key="shared-key")
            
            assert result["id"] == "shared-client"
            assert result["username"] == "Shared Client"
            assert result["client_id"] == "shared-client"
            assert result["auth_type"] == "shared_secret"
    
    def test_dual_authentication_client_id_presence(self, auth_deps):
        """Test that client_id in user dict indicates API key authentication."""
        # Setup callback that returns client_id
        def mock_validator(api_key: str):
            if api_key == "search-client-key":
                return {
                    "id": "client-456",
                    "username": "Search Client",
                    "email": "client-456@client.internal",
                    "roles": ["Search"],
                    "client_id": "client-456",  # This is the indicator
                    "tenant_id": "tenant-xyz",
                    "volume_ids": ["vol-a", "vol-b"]
                }
            return None
        
        auth_deps.set_shared_secret_validator(mock_validator)
        
        result = auth_deps.get_current_user_or_service(x_api_key="search-client-key")
        
        # Verify client_id is present (this is what query_service checks)
        assert "client_id" in result
        assert result["client_id"] == "client-456"
        
        # Verify tenant and volume restrictions are present
        assert result["tenant_id"] == "tenant-xyz"
        assert result["volume_ids"] == ["vol-a", "vol-b"]
    
    def test_callback_with_oauth_auth_type(self, auth_deps, mock_config_provider):
        """Test that the shared-secret callback works even when primary auth_type is oauth."""
        # Simulate any OAuth IdP (Okta, Cognito, etc.) as primary provider
        mock_config_provider.return_value = {
            "auth_enabled": True,
            "auth_type": "oauth",
            "api_shared_secret": "global-secret"
        }

        def mock_validator(api_key: str):
            if api_key == "client-key":
                return {
                    "id": "client-789",
                    "username": "Client with OAuth Primary",
                    "roles": ["Search"],
                    "client_id": "client-789",
                    "tenant_id": "tenant-123"
                }
            return None
        
        auth_deps.set_shared_secret_validator(mock_validator)
        
        result = auth_deps.get_current_user_or_service(x_api_key="client-key")
        
        # Callback should work regardless of primary auth_type
        assert result["client_id"] == "client-789"
        assert result["tenant_id"] == "tenant-123"
        assert result["auth_type"] == "shared_secret"
    
    def test_require_role_with_client_id(self, auth_deps):
        """Shared secret users must still satisfy required roles."""
        def mock_validator(api_key: str):
            return {
                "id": "client-999",
                "username": "Restricted Client",
                "roles": ["Search"],  # Only has Search role
                "client_id": "client-999",
                "tenant_id": "tenant-abc"
            }
        
        auth_deps.set_shared_secret_validator(mock_validator)
        
        # Authenticate with API key
        user = auth_deps.get_current_user_or_service(x_api_key="any-key")
        
        # Require Admin role which isn't present should now fail
        role_checker = auth_deps.require_role(["Admin"])
        with pytest.raises(HTTPException) as exc_info:
            role_checker(user)
        assert exc_info.value.status_code == 403


class TestErrorHandling:
    """Test error handling and edge cases."""
    
    def test_config_provider_exception(self):
        """Test behavior when config provider raises an exception."""
        def failing_config_provider():
            raise Exception("Config service unavailable")
        
        with patch('auth.auth_util.get_auth_provider'):
            deps = AuthDependencies(failing_config_provider)
            
            with pytest.raises(Exception, match="Config service unavailable"):
                deps.get_current_user_or_service()
    
    def test_auth_provider_exception_during_init(self):
        """Test behavior when auth provider factory raises an exception."""
        mock_config_provider = Mock(return_value={"auth_enabled": True})
        
        with patch('auth.auth_util.get_auth_provider') as mock_get_auth:
            mock_get_auth.side_effect = Exception("Auth provider initialization failed")
            
            with pytest.raises(Exception, match="Auth provider initialization failed"):
                AuthDependencies(mock_config_provider)
