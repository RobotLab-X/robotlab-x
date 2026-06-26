"""
Tests for monitor factory functionality and local monitor implementation.
"""

import pytest
from unittest.mock import Mock, patch, MagicMock

from monitor.factory import create_monitor, get_monitor
from monitor.interface import IMonitor
from monitor.local_monitor import LocalMonitor
from models.monitor_local_config import MonitorLocalConfig
from models.monitor_data import MonitorData


class TestMonitorFactory:
    """Test the monitor factory functions."""
    
    def test_create_local_monitor(self):
        """Test creating a local monitor through factory."""
        config = MonitorLocalConfig(
            name="test_monitor",
            log_level="INFO",
            log_file="/tmp/monitor.log"
        )
        
        result = create_monitor(config)
        
        # create_monitor returns None but stores the monitor internally
        assert result is None
        
        # We should be able to retrieve the monitor
        monitor = get_monitor("test_monitor")
        assert isinstance(monitor, LocalMonitor)
        assert isinstance(monitor, IMonitor)
    
    def test_create_monitor_invalid_config(self):
        """Test creating monitor with invalid config type."""
        invalid_config = {"not": "a valid config object"}
        
        with pytest.raises(ValueError, match="Config must provide a name or id"):
            create_monitor(invalid_config)
    
    def test_create_monitor_unsupported_config_type(self):
        """Test creating monitor with unsupported config type."""
        class InvalidConfig:
            def __init__(self):
                self.name = "test_invalid"
        
        invalid_config = InvalidConfig()
        
        with pytest.raises(ValueError, match="Unsupported monitor config type"):
            create_monitor(invalid_config)
    
    def test_create_monitor_none_config(self):
        """Test creating monitor with None config."""
        with pytest.raises(ValueError, match="Config must provide a name or id"):
            create_monitor(None)
    
    def test_create_monitor_no_name(self):
        """Test creating monitor with config that has no name."""
        class ConfigWithoutName:
            pass
        
        config = ConfigWithoutName()
        
        with pytest.raises(ValueError, match="Config must provide a name or id"):
            create_monitor(config)
    
    def test_get_monitor_not_found(self):
        """Test retrieving a non-existent monitor."""
        monitor = get_monitor("nonexistent")
        assert monitor is None
    
    def test_get_monitor_default_name(self):
        """Test retrieving monitor with default name."""
        # First create a monitor with name "default"
        config = MonitorLocalConfig(
            name="default",
            log_level="INFO"
        )
        create_monitor(config)
        
        # Should be able to retrieve it without specifying name
        monitor = get_monitor()
        assert isinstance(monitor, LocalMonitor)
    
    def test_create_duplicate_monitor_name(self):
        """Test creating monitor with duplicate name."""
        config1 = MonitorLocalConfig(
            name="duplicate",
            log_level="INFO"
        )
        config2 = MonitorLocalConfig(
            name="duplicate", 
            log_level="DEBUG"
        )
        
        # Create first monitor
        create_monitor(config1)
        first_monitor = get_monitor("duplicate")
        
        # Attempt to create second monitor with same name
        with patch('logging.error') as mock_log:
            result = create_monitor(config2)
            
            # Should return None and log error
            assert result is None
            mock_log.assert_called_once()
            
            # Original monitor should still exist
            same_monitor = get_monitor("duplicate")
            assert same_monitor is first_monitor


class TestLocalMonitor:
    """Test the LocalMonitor implementation."""
    
    @pytest.fixture
    def config(self):
        """Create a test monitor config."""
        return MonitorLocalConfig(
            name="test_local",
            log_level="INFO",
            log_file="/tmp/test_monitor.log"
        )
    
    @pytest.fixture
    def monitor(self, config):
        """Create a LocalMonitor instance."""
        return LocalMonitor(config)
    
    def test_local_monitor_initialization(self, config):
        """Test LocalMonitor initialization."""
        monitor = LocalMonitor(config)
        
        assert monitor.config == config
        assert hasattr(monitor, '_running')
        assert hasattr(monitor, '_thread')
        assert hasattr(monitor, '_data')
        assert monitor._running is False
        assert monitor._thread is None
    
    def test_monitor_implements_interface(self, monitor):
        """Test that LocalMonitor properly implements IMonitor interface."""
        assert isinstance(monitor, IMonitor)
        assert hasattr(monitor, 'start')
        assert hasattr(monitor, 'stop')
        assert hasattr(monitor, 'get_data')
    
    def test_monitor_start(self, monitor):
        """Test starting monitoring session."""
        # Should start without errors
        monitor.start()
        
        # Verify monitor state
        assert monitor._running is True
        assert monitor._thread is not None
        assert monitor._thread.is_alive()
        
        # Clean up
        monitor.stop()
    
    def test_monitor_stop(self, monitor):
        """Test stopping monitoring session."""
        # Start first so we have something to stop
        monitor.start()
        assert monitor._running is True
        
        # Now stop
        monitor.stop()
        
        # Verify monitor state
        assert monitor._running is False
        # Thread should be None or not alive after stop
        if monitor._thread:
            assert not monitor._thread.is_alive()
    
    def test_monitor_get_data(self, monitor):
        """Test getting monitor data."""
        data = monitor.get_data()
        
        assert isinstance(data, MonitorData)
        assert hasattr(data, 'id')
        assert hasattr(data, 'name')
        assert hasattr(data, 'started')
        assert hasattr(data, 'drive_space_total_gb')
        assert hasattr(data, 'memory_total_gb')
        assert hasattr(data, 'load_average')
        assert data.id == monitor.config.id
        assert data.name == monitor.config.name
    
    def test_monitor_config_validation(self):
        """Test monitor config validation."""
        # Valid config
        valid_config = MonitorLocalConfig(
            name="valid_monitor",
            log_level="INFO",
            log_file="/tmp/valid.log"
        )
        monitor = LocalMonitor(valid_config)
        assert monitor.config == valid_config
        
        # Test with minimal config
        minimal_config = MonitorLocalConfig(name="minimal")
        monitor = LocalMonitor(minimal_config)
        assert monitor.config == minimal_config


class TestMonitorIntegration:
    """Test monitor integration scenarios."""
    
    def test_create_and_retrieve_monitor(self):
        """Test creating and retrieving a monitor."""
        """Test creating and retrieving monitor through factory."""
        config = MonitorLocalConfig(
            name="integration_test",
            interval_seconds=30,
            check_disk_space_used_threshold_percent=85
        )
        
        # Create monitor
        create_monitor(config)
        
        # Retrieve and verify
        monitor = get_monitor("integration_test")
        assert isinstance(monitor, LocalMonitor)
        assert monitor.config.name == "integration_test"
        assert monitor.config.interval_seconds == 30
        assert monitor.config.check_disk_space_used_threshold_percent == 85
    
    def test_monitor_lifecycle(self):
        """Test complete monitor lifecycle."""
        config = MonitorLocalConfig(
            name="lifecycle_test",
            interval_seconds=45,
            check_memory_used_threshold_percent=85
        )
        
        # Create monitor
        create_monitor(config)
        monitor = get_monitor("lifecycle_test")
        
        # Test lifecycle methods
        monitor.start()
        data = monitor.get_data()
        assert isinstance(data, MonitorData)
        monitor.stop()
        
        # Should still be able to get data after stopping
        data2 = monitor.get_data()
        assert isinstance(data2, MonitorData)
    
    def test_multiple_monitors(self):
        """Test managing multiple monitors."""
        config1 = MonitorLocalConfig(name="monitor1", log_level="INFO")
        config2 = MonitorLocalConfig(name="monitor2", log_level="DEBUG")
        
        # Create multiple monitors
        create_monitor(config1)
        create_monitor(config2)
        
        # Retrieve each monitor
        monitor1 = get_monitor("monitor1")
        monitor2 = get_monitor("monitor2")
        
        assert isinstance(monitor1, LocalMonitor)
        assert isinstance(monitor2, LocalMonitor)
        assert monitor1 is not monitor2
        assert monitor1.config.name == "monitor1"
        assert monitor2.config.name == "monitor2"


class TestMonitorData:
    """Test monitor data functionality."""
    
    def test_monitor_data_creation(self):
        """Test creating monitor data."""
        data = MonitorData(
            id="test-monitor",
            name="test_monitor",
            started=1683123456789,
            memory_total_gb=16
        )
        
        assert data.id == "test-monitor"
        assert data.name == "test_monitor" 
        assert data.started == 1683123456789
        assert data.memory_total_gb == 16
    
    def test_monitor_returns_valid_data(self):
        """Test that monitor returns valid data."""
        config = MonitorLocalConfig(name="data_test")
        monitor = LocalMonitor(config)
        
        data = monitor.get_data()
        
        assert isinstance(data, MonitorData)
        assert isinstance(data.id, str)
        assert isinstance(data.name, str)
        assert isinstance(data.started, int)
        assert data.id == "default"
        assert data.name == "data_test"


class TestMonitorInterface:
    """Test the IMonitor interface."""
    
    def test_monitor_interface_cannot_be_instantiated(self):
        """Test that IMonitor cannot be instantiated directly."""
        with pytest.raises(TypeError):
            IMonitor()
    
    def test_local_monitor_implements_interface(self):
        """Test that LocalMonitor properly implements IMonitor."""
        config = MonitorLocalConfig(name="interface_test")
        monitor = LocalMonitor(config)
        
        # Should implement all required methods
        assert hasattr(monitor, 'start')
        assert hasattr(monitor, 'stop') 
        assert hasattr(monitor, 'get_data')
        
        # Should be instance of interface
        assert isinstance(monitor, IMonitor)
        
        # Methods should be callable
        assert callable(monitor.start)
        assert callable(monitor.stop)
        assert callable(monitor.get_data)
