"""Shared serial-port enumeration with ownership detection.

Lives in ``rlx_bus`` because every subprocess service that wants to
open a serial device (``arduino``, ``serial``, future GPS / LIDAR
/ etc.) needs the same data: what's plugged in, what's already
held by another process, and ideally which proxy_id owns it.

Two entry points:

  * ``list_ports()`` — pyserial-based enumeration, filtered to
    USB-serial / CDC devices on Linux+macOS, all COM* on Windows.
    Each entry is enriched with ``holders`` (a list of processes
    currently keeping the device open) and ``available`` (a
    convenience boolean — empty holders).
  * ``scan_port_holders()`` — the holder map standalone, in case
    a caller wants it without the list_ports filtering.

The holder scan is Linux-only (uses ``/proc``); on other
platforms it returns an empty map and ``available`` defaults
True. Consumers should always treat holder info as a best-effort
hint, not a hard contract — the kernel state can change between
the scan and a subsequent ``open()``.
"""
from __future__ import annotations

import os
from typing import Any, Dict, List, Optional


# What we consider "a real serial port" for the purposes of the
# dropdown. Linux exposes 32 virtual ``ttyS*`` UARTs per host that
# are almost never what the operator wants; filter them out. macOS
# uses ``cu.usb*`` naming. Windows COM* paths fall outside this
# filter and are included unconditionally below.
USB_SERIAL_PREFIXES = ("ttyACM", "ttyUSB", "cu.usbserial", "cu.usbmodem")


def scan_port_holders() -> Dict[str, List[Dict[str, Any]]]:
    """Linux-only: walk ``/proc/<pid>/fd/*`` and return the set of
    processes holding each ``/dev/tty*`` device.

    Returns a map of device path → list of holder records::

        {"/dev/ttyACM0": [{"pid": 12345,
                           "proxy_id": "arduino-1",
                           "service_type": "arduino",
                           "name": "python"}, ...]}

    ``proxy_id`` is recovered from the process's
    ``ROBOTLAB_X_PROXY_ID`` env var (set by the runtime's
    ``process_manager.py`` when spawning a subprocess service).
    ``service_type`` is parsed out of cmdline (it's the python
    ``-m`` module name like ``arduino_service``). Non-RLX
    processes still get listed with ``proxy_id=None`` /
    ``service_type=None`` so the operator at least sees the PID +
    binary name.

    On non-Linux platforms or when ``/proc`` is unreadable,
    returns an empty dict.
    """
    holders: Dict[str, List[Dict[str, Any]]] = {}
    proc_dir = "/proc"
    if not os.path.isdir(proc_dir):
        return holders
    for entry in os.listdir(proc_dir):
        if not entry.isdigit():
            continue
        pid = int(entry)
        fd_dir = f"{proc_dir}/{entry}/fd"
        if not os.path.isdir(fd_dir):
            continue
        try:
            fds = os.listdir(fd_dir)
        except (FileNotFoundError, PermissionError):
            continue
        # Lazy: only resolve metadata if we find at least one tty fd
        # on this process. Avoids cmdline/environ reads per-pid for
        # the common "process doesn't touch serial" case.
        metadata_loaded = False
        proxy_id: Optional[str] = None
        service_type: Optional[str] = None
        name: Optional[str] = None
        for fd in fds:
            try:
                target = os.readlink(f"{fd_dir}/{fd}")
            except (FileNotFoundError, PermissionError):
                continue
            if not target.startswith("/dev/tty"):
                continue
            if not metadata_loaded:
                metadata_loaded = True
                try:
                    with open(f"{proc_dir}/{entry}/comm", "r") as fh:
                        name = fh.read().strip()
                except (FileNotFoundError, PermissionError):
                    pass
                try:
                    with open(f"{proc_dir}/{entry}/cmdline", "rb") as fh:
                        cmdline = fh.read().replace(b"\x00", b" ").decode("utf-8", "replace")
                    # Best-effort service-type tag — any ``*_service``
                    # python module on the command line wins. Lets
                    # the UI label e.g. "arduino" without needing a
                    # central registry.
                    for token in cmdline.split():
                        if token.endswith("_service"):
                            service_type = token[: -len("_service")]
                            break
                except (FileNotFoundError, PermissionError):
                    pass
                try:
                    with open(f"{proc_dir}/{entry}/environ", "rb") as fh:
                        env_blob = fh.read()
                    for var in env_blob.split(b"\x00"):
                        if var.startswith(b"ROBOTLAB_X_PROXY_ID="):
                            proxy_id = var.split(b"=", 1)[1].decode("utf-8", "replace")
                            break
                except (FileNotFoundError, PermissionError):
                    pass
            holders.setdefault(target, []).append({
                "pid": pid,
                "proxy_id": proxy_id,
                "service_type": service_type,
                "name": name,
            })
    return holders


def list_ports() -> List[Dict[str, Any]]:
    """Enumerate likely serial devices on this host. Returns a list
    of ``{device, description, hwid, holders, available}`` dicts.

    Returns ``[]`` if pyserial isn't installed in this service's
    venv (which would be unusual — every serial-touching service
    pulls pyserial in transitively, but be defensive).
    """
    try:
        from serial.tools import list_ports as _pyserial_list_ports  # type: ignore
    except ImportError:
        return []
    holders = scan_port_holders()
    out: List[Dict[str, Any]] = []
    for info in _pyserial_list_ports.comports():
        device = info.device or ""
        name = os.path.basename(device)
        # Windows: pyserial returns ``COM3``-style paths with no
        # directory prefix to filter on; include everything.
        if name.startswith("COM"):
            include = True
        else:
            include = any(name.startswith(p) for p in USB_SERIAL_PREFIXES)
        if not include:
            continue
        h = holders.get(device, [])
        out.append({
            "device": device,
            "description": info.description or "",
            "hwid": info.hwid or "",
            "holders": h,
            "available": len(h) == 0,
        })
    return out
