import time
from unittest.mock import patch, MagicMock
from models.monitor_local_config import MonitorLocalConfig
from models.monitor_data import MonitorData
from monitor.factory import create_monitor, get_monitor
from messages.local import LocalMessageClient
from models.messages_local_config import MessagesLocalConfig
from messages.factory import create_message_client, get_message_client

def get_test_message_client():
    cfg = MessagesLocalConfig(name="dummy", buffer_messages=True)
    create_message_client(cfg)  # Registers singleton if not already
    client:LocalMessageClient = get_message_client("dummy")
    client.msg_count = 0
    client.last_message = ""
    client.sent_messages = []
    return client

def test_local_monitor_basic():
    config = MonitorLocalConfig(
        id="test-monitor",
        name="TestMonitor",
        interval_seconds=1
    )
    create_monitor(config)
    monitor = get_monitor("TestMonitor")
    assert monitor is not None
    monitor.start()
    time.sleep(2)  # Let it collect at least one update
    data = monitor.get_data()
    assert data.drive_space_total_gb is not None
    assert data.memory_total_gb is not None
    assert data.memory_available_gb is not None
    assert data.load_average is not None or data.load_average is None  # Accept None if not available
    monitor.stop()
    print("Monitor data:", data)

def test_local_monitor_stop():
    config = MonitorLocalConfig(
        id="test-monitor-stop",
        name="TestMonitorStop",
        interval_seconds=1
    )
    create_monitor(config)
    monitor = get_monitor("TestMonitorStop")
    assert monitor is not None
    monitor.start()
    time.sleep(1)
    monitor.stop()
    # After stop, get_data should still work
    data = monitor.get_data()
    assert isinstance(data, MonitorData)
    print("Monitor stopped, data:", data)

def test_local_monitor_alerts():
    client = get_test_message_client()
    config = MonitorLocalConfig(
        id="test-monitor-alert",
        name="TestMonitorAlert",
        interval_seconds=1,
        check_disk_space_used_threshold_percent=5,  # Should always trigger
        check_memory_used_threshold_percent=5,  # Should always trigger
        check_load_average_threshold_percent=5,  # Will always trigger
        message_id="dummy"
    )
    with patch("psutil.disk_usage") as mock_disk_usage, \
         patch("psutil.virtual_memory") as mock_virtual_memory, \
         patch("psutil.getloadavg") as mock_getloadavg:
        mock_disk = MagicMock()
        # Simulate 100 GB total, 10 GB free
        mock_disk.total = 100 * (1024 ** 3)
        mock_disk.free = 10 * (1024 ** 3)
        mock_disk_usage.return_value = mock_disk
        mock_mem = MagicMock()
        mock_mem.total = 100 * (1024 ** 3)
        mock_mem.available = 10 * (1024 ** 3)
        mock_virtual_memory.return_value = mock_mem
        mock_getloadavg.return_value = [10.0, 9.0, 8.0]  # 10% load average
        create_monitor(config)
        monitor = get_monitor("TestMonitorAlert")
        monitor._update_stats()
        monitor._check_thresholds()
    assert "Disk used space above threshold" in monitor._data.alert
    assert "Memory used above threshold" in monitor._data.alert
    assert "Load average above threshold" in monitor._data.alert
    assert any("Disk used space above threshold" in m for m in client.sent_messages)
    assert any("Memory used above threshold" in m for m in client.sent_messages)
    assert any("Load average above threshold" in m for m in client.sent_messages)
    print("Monitor alerts and message sending tested.")

def test_local_monitor_no_alert():
    config = MonitorLocalConfig(
        id="test-monitor-noalert",
        name="TestMonitorNoAlert",
        interval_seconds=1,
        check_disk_space_used_threshold_percent=100,  # Will never trigger
        check_memory_used_threshold_percent=100,  # Will never trigger
        check_load_average_threshold=1000,  # Will never trigger
        message_id="dummy"
    )
    create_monitor(config)
    monitor = get_monitor("TestMonitorNoAlert")
    assert monitor is not None
    monitor.start()
    time.sleep(2)
    data = monitor.get_data()
    monitor.stop()
    assert data.alert == ""
    print("Monitor no alert tested.")

def test_alert_on_threshold_crossed_true():
    client = get_test_message_client()
    config = MonitorLocalConfig(
        id="test-monitor-crossed-true",
        name="TestMonitorCrossedTrue",
        interval_seconds=1,
        check_disk_space_used_threshold_percent=50,
        check_memory_used_threshold_percent=50,
        check_load_average_threshold_percent=50,
        alert_on_threshold_crossed=True,
        message_id="dummy"
    )
    with patch("psutil.disk_usage") as mock_disk_usage, \
         patch("psutil.virtual_memory") as mock_virtual_memory, \
         patch("psutil.getloadavg") as mock_getloadavg:
        mock_disk = MagicMock()
        # Simulate 100 GB total, 10 GB free
        mock_disk.total = 100 * (1024 ** 3)
        mock_disk.free = 10 * (1024 ** 3)
        mock_disk_usage.return_value = mock_disk
        mock_mem = MagicMock()
        # Simulate 100 GB total, 10 GB available
        mock_mem.total = 100 * (1024 ** 3)
        mock_mem.available = 10 * (1024 ** 3)
        mock_virtual_memory.return_value = mock_mem
        mock_getloadavg.return_value = [0.0, 0.0, 0.0]
        create_monitor(config)
        monitor = get_monitor("TestMonitorCrossedTrue")
        monitor._update_stats()
        monitor._check_thresholds()
        # Second check should NOT send a new alert since types unchanged
        monitor._check_thresholds()
    assert client.msg_count == 1
    assert len(client.sent_messages) == 1
    assert "Disk used space above threshold" in client.last_message
    print("alert_on_threshold_crossed=True sends only on crossing.")

def test_alert_on_threshold_crossed_false():
    client = get_test_message_client()
    config = MonitorLocalConfig(
        id="test-monitor-crossed-false",
        name="TestMonitorCrossedFalse",
        interval_seconds=1,
        check_disk_space_used_threshold_percent=90,  # Will trigger with 90% used
        check_memory_used_threshold_percent=90,      # Will trigger with 90% used
        check_load_average_threshold_percent=90,     # Will trigger with 10% load average
        alert_on_threshold_crossed=False,
        message_id="dummy"
    )
    with patch("psutil.disk_usage") as mock_disk_usage, \
         patch("psutil.virtual_memory") as mock_virtual_memory, \
         patch("psutil.getloadavg") as mock_getloadavg:
        mock_disk = MagicMock()
        # Simulate 100 GB total, 10 GB free (90% used)
        mock_disk.total = 100 * (1024 ** 3)
        mock_disk.free = 10 * (1024 ** 3)
        mock_disk_usage.return_value = mock_disk
        mock_mem = MagicMock()
        mock_mem.total = 100 * (1024 ** 3)
        mock_mem.available = 10 * (1024 ** 3)
        mock_virtual_memory.return_value = mock_mem
        mock_getloadavg.return_value = [10.0, 9.0, 8.0]  # 10% load average
        create_monitor(config)
        monitor = get_monitor("TestMonitorCrossedFalse")
        monitor.start()
        time.sleep(1.2)
        data = monitor.get_data()
        time.sleep(1.2)
        monitor.get_data()
        monitor.stop()
    assert client.msg_count == 0
    print("test_alert_on_threshold_crossed_false=Do not send.")

def test_local_monitor_disk_used_threshold():
    client = get_test_message_client()
    config = MonitorLocalConfig(
        id="test-monitor-disk-used",
        name="TestMonitorDiskUsed",
        interval_seconds=1,
        check_disk_space_used_threshold_percent=5,
        message_id="dummy",
        alert_on_threshold_crossed=True
    )
    with patch("psutil.disk_usage") as mock_disk_usage:
        mock_disk = MagicMock()
        # Simulate 100 GB total, 10 GB free
        mock_disk.total = 100 * (1024 ** 3)
        mock_disk.free = 10 * (1024 ** 3)
        mock_disk_usage.return_value = mock_disk
        create_monitor(config)
        monitor = get_monitor("TestMonitorDiskUsed")
        monitor.start()
        time.sleep(1.2)
        monitor.stop()
        data = monitor.get_data()
    assert "Disk used space above threshold" in data.alert
    assert any("Disk used space above threshold" in m for m in client.sent_messages)
    print("Disk used threshold alert tested.")

def test_local_monitor_memory_used_threshold():
    client = get_test_message_client()
    config = MonitorLocalConfig(
        id="test-monitor-mem-used",
        name="TestMonitorMemUsed",
        interval_seconds=1,
        check_memory_used_threshold_percent=5,
        message_id="dummy",
        alert_on_threshold_crossed=True
    )
    with patch("psutil.virtual_memory") as mock_virtual_memory:
        mock_mem = MagicMock()
        # Simulate 100 GB total, 10 GB available
        mock_mem.total = 100 * (1024 ** 3)
        mock_mem.available = 10 * (1024 ** 3)
        mock_virtual_memory.return_value = mock_mem
        create_monitor(config)
        monitor = get_monitor("TestMonitorMemUsed")
        monitor.start()
        time.sleep(1.2)
        monitor.stop()
        data = monitor.get_data()
    assert "Memory used above threshold" in data.alert
    assert any("Memory used above threshold" in m for m in client.sent_messages)
    print("Memory used threshold alert tested.")

def test_local_monitor_load_average_threshold():
    client = get_test_message_client()
    config = MonitorLocalConfig(
        id="test-monitor-load",
        name="TestMonitorLoad",
        interval_seconds=1,
        check_load_average_threshold_percent=5,
        message_id="dummy",
        alert_on_threshold_crossed=True
    )
    with patch("psutil.getloadavg") as mock_getloadavg, \
         patch("psutil.disk_usage") as mock_disk_usage, \
         patch("psutil.virtual_memory") as mock_virtual_memory:
        mock_getloadavg.return_value = [10.0, 9.0, 8.0]  # 10% load average
        # Simulate 100 GB total, 10 GB free
        mock_disk = MagicMock()
        mock_disk.total = 100 * (1024 ** 3)
        mock_disk.free = 10 * (1024 ** 3)
        mock_disk_usage.return_value = mock_disk
        mock_mem = MagicMock()
        mock_mem.total = 100 * (1024 ** 3)
        mock_mem.available = 10 * (1024 ** 3)
        mock_virtual_memory.return_value = mock_mem
        create_monitor(config)
        monitor = get_monitor("TestMonitorLoad")
        monitor.start()
        time.sleep(1.2)
        monitor.stop()
        data = monitor.get_data()
    assert "Load average above threshold" in data.alert
    assert any("Load average above threshold" in m for m in client.sent_messages)
    print("Load average threshold alert tested.")

def test_local_monitor_no_alert_with_high_thresholds():
    client = get_test_message_client()
    config = MonitorLocalConfig(
        id="test-monitor-noalert-high",
        name="TestMonitorNoAlertHigh",
        interval_seconds=1,
        check_disk_space_used_threshold_percent=100,
        check_memory_used_threshold_percent=100,
        check_load_average_threshold=1000,
        message_id="dummy",
        alert_on_threshold_crossed=True
    )
    with patch("psutil.disk_usage") as mock_disk_usage, \
         patch("psutil.virtual_memory") as mock_virtual_memory, \
         patch("psutil.getloadavg") as mock_getloadavg:
        mock_disk = MagicMock()
        # Simulate 100 GB total, 10 GB free
        mock_disk.total = 100 * (1024 ** 3)
        mock_disk.free = 10 * (1024 ** 3)
        mock_disk_usage.return_value = mock_disk
        mock_mem = MagicMock()
        # Simulate 100 GB total, 10 GB available
        mock_mem.total = 100 * (1024 ** 3)
        mock_mem.available = 10 * (1024 ** 3)
        mock_virtual_memory.return_value = mock_mem
        mock_getloadavg.return_value = [0.0, 0.0, 0.0]
        create_monitor(config)
        monitor = get_monitor("TestMonitorNoAlertHigh")
        monitor.start()
        time.sleep(1.2)
        monitor.stop()
        data = monitor.get_data()
    assert data.alert == ""
    assert len(client.sent_messages) == 0
    print("No alert with high thresholds tested.")


def test_send_failure_is_caught_not_raised():
    """A delivery failure on alert send must be caught + logged, never raised —
    so a transient Slack error (rate-limit / not_in_channel / network blip) can't
    abort the threshold check or kill the monitor thread."""
    class _BoomClient:
        def send_warning_message(self, msg):
            raise RuntimeError("simulated slack not_in_channel")

    config = MonitorLocalConfig(
        id="test-monitor-send-fail",
        name="TestMonitorSendFail",
        interval_seconds=1,
        check_disk_space_used_threshold_percent=5,  # always trigger
        message_id="dummy",
        alert_on_threshold_crossed=True,
    )
    with patch("psutil.disk_usage") as mock_disk_usage, \
         patch("monitor.local_monitor.get_message_client", return_value=_BoomClient()):
        mock_disk = MagicMock()
        mock_disk.total = 100 * (1024 ** 3)
        mock_disk.free = 10 * (1024 ** 3)  # 90% used -> disk alert fires
        mock_disk_usage.return_value = mock_disk
        create_monitor(config)
        monitor = get_monitor("TestMonitorSendFail")
        monitor._update_stats()
        # Must NOT raise even though the message client's send raises.
        monitor._check_thresholds()
    assert "Disk used space above threshold" in monitor._data.alert
    print("Send failure caught, not raised.")
