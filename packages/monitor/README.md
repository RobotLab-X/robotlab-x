# Monitor - Repository guidelines

> **Parent**: [packages](../README.md) · **Repo root**: [Repo Root](../../README.md)

This is the `monitor` Python library for robust, type-safe system monitoring in a monorepo environment.

## Purpose

The `monitor` package provides local system monitoring with configurable thresholds for disk space, memory, and load average. It supports alerting when thresholds are crossed and can send notifications via a message client integration.

## Features
- Type-safe monitor interface and implementations
- Periodic system stats collection (disk, memory, load)
- Configurable thresholds for alerts
- Alerting logic with informative messages
- Integration with message clients for notifications
- Option to only send alerts when thresholds are newly crossed

## Common Usage

1. **Configure a monitor:**
   ```python
   from models.monitor_local_config import MonitorLocalConfig
   config = MonitorLocalConfig(
       id="my-monitor",
       name="MyMonitor",
       interval_seconds=60,
       check_disk_space_threshold_percent=80,
       check_memory_available_threshold_percent=90,
       check_load_average_threshold=1.0,
       message_id="default",
       alert_on_threshold_crossed=True
   )
   ```
2. **Create and start a monitor:**
   ```python
   from monitor.factory import create_monitor, get_monitor
   create_monitor(config)
   monitor = get_monitor("MyMonitor")
   monitor.start()
   ```
3. **Access monitoring data:**
   ```python
   data = monitor.get_data()
   print(data)
   ```
4. **Stop the monitor:**
   ```python
   monitor.stop()
   ```

## Alerting & Messaging
- Alerts are set in `MonitorData.alert` when thresholds are crossed.
- If a message client is configured, alerts are sent as notifications.
- With `alert_on_threshold_crossed=True`, alerts are only sent when the alert type changes (not for every check).

## Testing
Comprehensive unit tests are provided for monitoring, alerting, and messaging behavior.
