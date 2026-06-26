from models.monitor_local_config import MonitorLocalConfig
from models.monitor_data import MonitorData
from .interface import IMonitor
import psutil
import time
import threading
from messages.factory import get_message_client
import logging

class LocalMonitor(IMonitor):
    def __init__(self, config: MonitorLocalConfig):
        self.config: MonitorLocalConfig = config
        self._running = False
        self._thread = None
        self._data = MonitorData(
            id=config.id,
            name=config.name,
            started=int(time.time()),
            drive_space_total_gb=None,
            drive_free_space_gb=None,
            memory_total_gb=None,
            memory_available_gb=None,
            load_average=None,
        )
        self._last_alert = ""
        self._last_alert_types = set()  # Explicitly initialize previous alert state

    def start(self) -> None:
        if not self._running:
            self._running = True
            self._data.started = int(time.time())
            self._thread = threading.Thread(target=self._run, daemon=True)
            self._thread.start()

    def stop(self) -> None:
        self._running = False
        if self._thread:
            self._thread.join(timeout=2)
            self._thread = None

    def _run(self):
        while self._running:
            try:
                self._update_stats()
                self._check_thresholds()
            except Exception:
                # Never let a sampling/alerting error kill the monitor thread.
                # Log and keep looping so monitoring survives transient failures
                # (psutil hiccups, a Slack/transport error on send, etc.).
                logging.exception("resource monitor cycle failed; continuing")
            time.sleep(self.config.interval_seconds or 60)

    def _update_stats(self):
        disk = psutil.disk_usage("/")
        self._data.drive_space_total_gb = round(disk.total / (1024 ** 3), 2)
        self._data.drive_free_space_gb = round(disk.free / (1024 ** 3), 2)
        mem = psutil.virtual_memory()
        self._data.memory_total_gb = round(mem.total / (1024 ** 3), 2)
        self._data.memory_available_gb = round(mem.available / (1024 ** 3), 2)
        self._data.load_average = round(psutil.getloadavg()[0], 2) if hasattr(psutil, "getloadavg") else None

    def _check_thresholds(self):
        alerts = []
        alert_types = set()
        # Disk space threshold as percentage (used)
        if (
            hasattr(self.config, "check_disk_space_used_threshold_percent")
            and self.config.check_disk_space_used_threshold_percent is not None
            and self._data.drive_free_space_gb is not None
            and self._data.drive_space_total_gb is not None
            and self._data.drive_space_total_gb > 0
        ):
            percent_used_disk = 100 - (self._data.drive_free_space_gb / self._data.drive_space_total_gb) * 100
            if percent_used_disk > self.config.check_disk_space_used_threshold_percent:
                alerts.append(f"Disk used space above threshold: {percent_used_disk:.2f}% > {self.config.check_disk_space_used_threshold_percent}%")
                alert_types.add("disk")
        # Memory used threshold as percentage
        if (
            hasattr(self.config, "check_memory_used_threshold_percent")
            and self.config.check_memory_used_threshold_percent is not None
            and self._data.memory_available_gb is not None
            and self._data.memory_total_gb is not None
            and self._data.memory_total_gb > 0
        ):
            percent_used_mem = 100 - (self._data.memory_available_gb / self._data.memory_total_gb) * 100
            if percent_used_mem > self.config.check_memory_used_threshold_percent:
                alerts.append(f"Memory used above threshold: {percent_used_mem:.2f}% > {self.config.check_memory_used_threshold_percent}%")
                alert_types.add("memory")
        # Load average threshold as percentage (alert if >= threshold)
        if (
            hasattr(self.config, "check_load_average_threshold_percent")
            and self.config.check_load_average_threshold_percent is not None
            and self._data.load_average is not None
        ):
            # Assume load_average is already a percentage value (0-100)
            if self._data.load_average >= self.config.check_load_average_threshold_percent:
                alerts.append(f"Load average above threshold: {self._data.load_average}% >= {self.config.check_load_average_threshold_percent}%")
                alert_types.add("load")
        # Set alert field
        if alerts:
            alert_msg = " | ".join(alerts)
            self._data.alert = alert_msg
            # Only send alert if threshold is newly crossed or alert_on_threshold_crossed is False
            should_send = True
            if self.config.alert_on_threshold_crossed:
                # Only send if previous alert types are different
                if not hasattr(self, '_last_alert_types'):
                    self._last_alert_types = set()
                should_send = (alert_types != self._last_alert_types)
            # logging.info(f"Monitor Alert: {alert_msg} | should_send: {should_send}")
            if should_send and self.config.message_id:
                msg_client = get_message_client(self.config.message_id)
                if msg_client is not None:
                    # Always use send_message for LocalMessageClient.
                    # A delivery failure (Slack rate-limit / not_in_channel /
                    # network blip) must not abort the check or kill the thread —
                    # log it and let the threshold bookkeeping below still run so
                    # we don't re-spam the same alert every cycle.
                    try:
                        msg_client.send_warning_message(alert_msg)
                    except Exception:
                        logging.exception("resource monitor alert send failed: %s", alert_msg)
            self._last_alert = alert_msg
            self._last_alert_types = alert_types.copy()
        else:
            self._data.alert = ""
            self._last_alert = ""
            self._last_alert_types = set()

    def get_data(self) -> MonitorData:
        self._update_stats()
        self._check_thresholds()
        return self._data
