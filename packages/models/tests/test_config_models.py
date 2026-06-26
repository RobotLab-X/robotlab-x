"""
Tests for models configuration classes.
Tests the Pydantic models for various database and service configurations.
"""

import pytest
from pydantic import ValidationError

from models.database_postgres_config import DatabasePostgresConfig
from models.database_mongodb_config import DatabaseMongodbConfig
from models.database_sqlite_config import DatabaseSqliteConfig
from models.messages_slack_config import MessagesSlackConfig
from models.queue_sqs_config import QueueSqsConfig
from models.monitor_data import MonitorData


class TestDatabasePostgresConfig:
    """Test PostgreSQL database configuration model."""
    
    def test_postgres_config_creation_minimal(self):
        """Test creating PostgreSQL config with minimal required fields."""
        config = DatabasePostgresConfig(
            host="localhost",
            database="testdb",
            user="testuser",
            password="testpass"
        )
        
        assert config.host == "localhost"
        assert config.database == "testdb"
        assert config.user == "testuser"
        assert config.password == "testpass"
        assert config.port == 5432  # Default port
    
    def test_postgres_config_creation_full(self):
        """Test creating PostgreSQL config with all fields."""
        config = DatabasePostgresConfig(
            id="test-id-123",
            name="test-config",
            host="db.example.com",
            port=5433,
            database="production_db",
            user="prod_user",
            password="secure_pass",
            sslmode="require",
            ensure_table=False
        )
        
        assert config.id == "test-id-123"
        assert config.name == "test-config"
        assert config.host == "db.example.com"
        assert config.port == 5433
        assert config.database == "production_db"
        assert config.user == "prod_user"
        assert config.password == "secure_pass"
        assert config.sslmode == "require"
        assert config.ensure_table == False
    
    def test_postgres_config_invalid_port(self):
        """Test PostgreSQL config with invalid port type."""
        with pytest.raises(ValidationError):
            DatabasePostgresConfig(
                host="localhost",
                port="invalid_port",  # String instead of int
                database="testdb",
                user="user",
                password="pass"
            )
    
    def test_postgres_config_missing_required_fields(self):
        """Test PostgreSQL config with missing required fields."""
        with pytest.raises(ValidationError):
            DatabasePostgresConfig(
                host="localhost",
                # Missing database, user, password
            )
    
    def test_postgres_config_dict_conversion(self):
        """Test converting PostgreSQL config to dictionary."""
        config = DatabasePostgresConfig(
            host="localhost",
            database="testdb",
            user="testuser",
            password="testpass"
        )
        
        config_dict = config.model_dump()
        assert isinstance(config_dict, dict)
        assert config_dict["host"] == "localhost"
        assert config_dict["database"] == "testdb"
        assert config_dict["user"] == "testuser"
        assert config_dict["password"] == "testpass"


class TestDatabaseMongodbConfig:
    """Test MongoDB database configuration model."""
    
    def test_mongodb_config_creation_minimal(self):
        """Test creating MongoDB config with minimal required fields."""
        config = DatabaseMongodbConfig(
            mongodb_replica_uri="mongodb://localhost:27017",
            mongodb_database_name="testdb"
        )
        
        assert config.mongodb_replica_uri == "mongodb://localhost:27017"
        assert config.mongodb_database_name == "testdb"
        assert config.mongodb_max_pool_size == 10  # Default value
        assert config.mongodb_min_pool_size == 1   # Default value
    
    def test_mongodb_config_creation_full(self):
        """Test creating MongoDB config with all fields."""
        config = DatabaseMongodbConfig(
            id="test-mongo-id",
            name="test-mongo-config",
            mongodb_replica_uri="mongodb://user:pass@cluster.mongodb.net/",
            mongodb_database_name="production_db",
            mongodb_max_pool_size=20,
            mongodb_min_pool_size=5
        )
        
        assert config.id == "test-mongo-id"
        assert config.name == "test-mongo-config"
        assert config.mongodb_replica_uri == "mongodb://user:pass@cluster.mongodb.net/"
        assert config.mongodb_database_name == "production_db"
        assert config.mongodb_max_pool_size == 20
        assert config.mongodb_min_pool_size == 5
    
    def test_mongodb_config_invalid_connection_string(self):
        """Test MongoDB config with invalid connection string."""
        # Since the model doesn't validate URI format, test with wrong type
        with pytest.raises(ValidationError):
            DatabaseMongodbConfig(
                mongodb_replica_uri=12345,  # Should be string
                mongodb_database_name="testdb"
            )


class TestDatabaseSqliteConfig:
    """Test SQLite database configuration model."""
    
    def test_sqlite_config_creation_minimal(self):
        """Test creating SQLite config with minimal required fields."""
        config = DatabaseSqliteConfig(
            sqlite_path="/path/to/database.db"
        )
        
        assert config.sqlite_path == "/path/to/database.db"
        assert config.id == "default"  # Default value
        assert config.name == "default"  # Default value
    
    def test_sqlite_config_creation_full(self):
        """Test creating SQLite config with all fields."""
        config = DatabaseSqliteConfig(
            id="test-sqlite-id",
            name="test-sqlite-config",
            sqlite_path="/path/to/production.db"
        )
        
        assert config.id == "test-sqlite-id"
        assert config.name == "test-sqlite-config"
        assert config.sqlite_path == "/path/to/production.db"
    
    def test_sqlite_config_invalid_path_type(self):
        """Test SQLite config with invalid path type."""
        with pytest.raises(ValidationError):
            DatabaseSqliteConfig(
                sqlite_path=12345  # Integer instead of string
            )


class TestMessagesSlackConfig:
    """Test Slack messages configuration model."""
    
    def test_slack_config_creation_minimal(self):
        """Test creating Slack config with minimal required fields."""
        config = MessagesSlackConfig(
            slack_token="xoxb-token",
            channel="#general"
        )
        
        assert config.slack_token == "xoxb-token"
        assert config.channel == "#general"
        assert config.id == "default"  # Default value
        assert config.name == "default"  # Default value
        assert config.prefix == ""  # Default value
    
    def test_slack_config_creation_full(self):
        """Test creating Slack config with all fields."""
        config = MessagesSlackConfig(
            id="test-slack-id",
            name="test-slack-config",
            prefix="[ALERT] ",
            slack_token="xoxb-production-token",
            channel="#alerts"
        )
        
        assert config.id == "test-slack-id"
        assert config.name == "test-slack-config"
        assert config.prefix == "[ALERT] "
        assert config.slack_token == "xoxb-production-token"
        assert config.channel == "#alerts"
    
    def test_slack_config_invalid_token_format(self):
        """Test Slack config with invalid token type."""
        # Since the model doesn't validate token format, test with wrong type
        with pytest.raises(ValidationError):
            MessagesSlackConfig(
                slack_token=12345,  # Integer instead of string
                channel="#general"
            )


class TestQueueSqsConfig:
    """Test SQS queue configuration model."""
    
    def test_sqs_config_creation_minimal(self):
        """Test creating SQS config with minimal required fields."""
        config = QueueSqsConfig(
            queue_url="https://sqs.us-east-1.amazonaws.com/123456789012/myqueue",
            aws_access_key_id="AKIATEST",
            aws_secret_access_key="secretkey"
        )
        
        assert config.queue_url == "https://sqs.us-east-1.amazonaws.com/123456789012/myqueue"
        assert config.aws_access_key_id == "AKIATEST"
        assert config.aws_secret_access_key == "secretkey"
        assert config.id == "default"  # Default value
        assert config.name == "default"  # Default value
        assert config.region_name is None  # Default value
    
    def test_sqs_config_creation_full(self):
        """Test creating SQS config with all fields."""
        config = QueueSqsConfig(
            id="test-sqs-id",
            name="test-sqs-config",
            queue_url="https://sqs.eu-west-1.amazonaws.com/123456789012/prodqueue",
            aws_access_key_id="AKIA-PROD-KEY",
            aws_secret_access_key="prod-secret-key",
            region_name="eu-west-1"
        )
        
        assert config.id == "test-sqs-id"
        assert config.name == "test-sqs-config"
        assert config.queue_url == "https://sqs.eu-west-1.amazonaws.com/123456789012/prodqueue"
        assert config.aws_access_key_id == "AKIA-PROD-KEY"
        assert config.aws_secret_access_key == "prod-secret-key"
        assert config.region_name == "eu-west-1"
    
    def test_sqs_config_invalid_queue_url(self):
        """Test SQS config with invalid queue URL type."""
        with pytest.raises(ValidationError):
            QueueSqsConfig(
                queue_url=12345,  # Integer instead of string
                aws_access_key_id="AKIATEST",
                aws_secret_access_key="secretkey"
            )


class TestMonitorData:
    """Test MonitorData model."""
    
    def test_monitor_data_creation_minimal(self):
        """Test creating monitor data with minimal required fields."""
        data = MonitorData()  # All fields are optional
        
        assert data.id == "default"
        assert data.name == "default"
        assert data.started is None
        assert data.drive_space_total_gb is None
        assert data.drive_free_space_gb is None
        assert data.memory_total_gb is None
        assert data.memory_available_gb is None
        assert data.load_average is None
        assert data.alert is None
    
    def test_monitor_data_creation_full(self):
        """Test creating monitor data with all fields."""
        data = MonitorData(
            id="monitor-01",
            name="server-monitor",
            started=1683123456789,
            drive_space_total_gb=500,
            drive_free_space_gb=200,
            memory_total_gb=16,
            memory_available_gb=8,
            load_average=0.5,
            alert="Disk space low"
        )
        
        assert data.id == "monitor-01"
        assert data.name == "server-monitor"
        assert data.started == 1683123456789
        assert data.drive_space_total_gb == 500
        assert data.drive_free_space_gb == 200
        assert data.memory_total_gb == 16
        assert data.memory_available_gb == 8
        assert data.load_average == 0.5
        assert data.alert == "Disk space low"
    
    def test_monitor_data_invalid_value_type(self):
        """Test monitor data with invalid value type."""
        with pytest.raises(ValidationError):
            MonitorData(
                id="test",
                name="test-monitor",
                memory_total_gb="not-a-number"  # Should be int
            )
    
    def test_monitor_data_accepts_negative_values(self):
        """Test monitor data accepts negative values since no validation constraints exist."""
        data = MonitorData(
            id="test",
            name="test-monitor",
            memory_total_gb=-16  # Negative values are allowed by the model
        )
        assert data.memory_total_gb == -16


class TestConfigSerialization:
    """Test serialization and deserialization of configuration models."""
    
    def test_postgres_config_json_roundtrip(self):
        """Test PostgreSQL config JSON serialization roundtrip."""
        original = DatabasePostgresConfig(
            host="localhost",
            database="testdb",
            user="user",
            password="pass",
            port=5433
        )
        
        # Serialize to JSON
        json_str = original.model_dump_json()
        
        # Deserialize from JSON
        data = original.model_validate_json(json_str)
        reconstructed = DatabasePostgresConfig(**data.model_dump())
        
        assert reconstructed.host == original.host
        assert reconstructed.database == original.database
        assert reconstructed.user == original.user
        assert reconstructed.password == original.password
        assert reconstructed.port == original.port
    
    def test_monitor_data_dict_roundtrip(self):
        """Test monitor data dictionary serialization roundtrip."""
        original = MonitorData(
            id="monitor-test",
            name="test-monitor",
            started=1683123456789,
            memory_total_gb=16
        )
        
        # Serialize to dict
        data_dict = original.model_dump()
        
        # Deserialize from dict
        reconstructed = MonitorData(**data_dict)
        
        assert reconstructed.id == original.id
        assert reconstructed.name == original.name
        assert reconstructed.started == original.started
        assert reconstructed.memory_total_gb == original.memory_total_gb
    
    def test_slack_config_exclude_sensitive_data(self):
        """Test that sensitive data can be excluded from serialization."""
        config = MessagesSlackConfig(
            slack_token="xoxb-sensitive-token",
            channel="#general"
        )
        
        # Serialize excluding sensitive fields
        safe_dict = config.model_dump(exclude={"slack_token"})
        
        assert "slack_token" not in safe_dict
        assert safe_dict["channel"] == "#general"
