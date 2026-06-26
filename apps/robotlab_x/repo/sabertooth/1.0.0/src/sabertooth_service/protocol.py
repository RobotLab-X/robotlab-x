"""Sabertooth 2x25 Packetized Serial protocol encoder.

Pure, side-effect-free byte encoding for the Dimension Engineering
Sabertooth "Packetized Serial" mode (datasheet:
https://www.dimensionengineering.com/datasheets/Sabertooth2x25.pdf).

Wire format — every command is a 4-byte packet::

    [address, command, data, checksum]

  * address  — 128..135, selected by the driver's DIP switches. The
               only byte with its high bit set, which lets the
               Sabertooth frame packets in a noisy stream.
  * command  — see the COMMAND constants below (0..127).
  * data     — payload, 0..127.
  * checksum — ``(address + command + data) & 0x7F`` (high bit masked
               off so it can never be confused with an address byte).

Speed values on the wire are unsigned magnitudes 0..127 plus a
direction encoded in the *command* (separate forward/backward command
per motor). This module exposes a friendlier signed-float surface
(``-1.0..+1.0``) via :func:`drive_packet` and converts to the wire
representation internally.

Autobaud — on power-up the Sabertooth listens for the byte ``0xAA``
to lock onto the host's baud rate. :data:`AUTOBAUD_BYTE` is sent once
right after the port opens (it is a bare byte, NOT a 4-byte packet).

Keep this module dependency-free and pure so it can be unit-tested
without a serial port (see tests/test_sabertooth_service.py).
"""
from __future__ import annotations


# ─── framing constants ───────────────────────────────────────────────

# Sent once after the port opens so the Sabertooth can detect the baud
# rate. A bare byte, not a packet.
AUTOBAUD_BYTE = 0xAA

# Address range selectable on the driver's DIP switches 1..3. 128 is
# the factory default (all relevant switches off).
ADDRESS_MIN = 128
ADDRESS_MAX = 135

# Magnitude range carried in the data byte. 0 = stop, 127 = full.
DATA_MAX = 127

# ─── command bytes (Packetized Serial, single-channel set) ───────────
# Each motor has a forward and a backward command; direction lives in
# the command, magnitude in the data byte.
CMD_M1_FORWARD = 0
CMD_M1_BACKWARD = 1
CMD_MIN_VOLTAGE = 2
CMD_MAX_VOLTAGE = 3
CMD_M2_FORWARD = 4
CMD_M2_BACKWARD = 5
# Configuration commands.
CMD_SERIAL_TIMEOUT = 14   # data = timeout in 100ms units; 0 disables
CMD_BAUD_RATE = 15        # data = 1:2400 2:9600 3:19200 4:38400 5:115200
CMD_RAMPING = 16          # data = 0 off; 1-10 fast; 11-20 medium; 21-80 slow
CMD_DEADBAND = 17         # data = deadband half-width 0..127

# The two physical motor channels the 2x25 drives.
MOTOR_CHANNELS = (1, 2)

# Per-motor (forward, backward) command pair, keyed by 1-based channel.
_DIRECTION_COMMANDS = {
    1: (CMD_M1_FORWARD, CMD_M1_BACKWARD),
    2: (CMD_M2_FORWARD, CMD_M2_BACKWARD),
}

# Baud-rate code map for CMD_BAUD_RATE. Only these rates are valid in
# Packetized Serial mode.
BAUD_CODES = {2400: 1, 9600: 2, 19200: 3, 38400: 4, 115200: 5}


# ─── encoders ─────────────────────────────────────────────────────────


def checksum(address: int, command: int, data: int) -> int:
    """The Sabertooth packet checksum: low 7 bits of the byte sum."""
    return (address + command + data) & 0x7F


def packet(address: int, command: int, data: int) -> bytes:
    """Build a raw 4-byte command packet, validating every field.

    Raises ``ValueError`` for any out-of-range field rather than
    silently truncating — a malformed packet on a motor driver is a
    safety problem, not something to paper over.
    """
    if not (ADDRESS_MIN <= address <= ADDRESS_MAX):
        raise ValueError(
            f"address must be {ADDRESS_MIN}..{ADDRESS_MAX} (got {address})"
        )
    if not (0 <= command <= 127):
        raise ValueError(f"command must be 0..127 (got {command})")
    if not (0 <= data <= DATA_MAX):
        raise ValueError(f"data must be 0..{DATA_MAX} (got {data})")
    return bytes([address, command, data, checksum(address, command, data)])


def value_to_data(value: float) -> int:
    """Map a signed throttle ``-1.0..+1.0`` to a 0..127 magnitude.

    The sign is dropped here (direction is encoded in the command);
    callers decide forward vs backward from ``value >= 0``. Values
    outside the range are clamped, not rejected — the clamp is the
    last line of defence against an out-of-range command reaching the
    motor.
    """
    mag = abs(float(value))
    if mag > 1.0:
        mag = 1.0
    return int(round(mag * DATA_MAX))


def drive_packet(address: int, motor: int, value: float) -> bytes:
    """Encode a signed throttle command for one motor channel.

    ``motor`` is the 1-based channel (1 or 2). ``value`` is the signed
    throttle ``-1.0..+1.0``; the sign picks the forward/backward
    command and the magnitude becomes the data byte. ``value == 0``
    encodes a stop (forward command, data 0).
    """
    if motor not in _DIRECTION_COMMANDS:
        raise ValueError(f"motor must be one of {MOTOR_CHANNELS} (got {motor})")
    forward_cmd, backward_cmd = _DIRECTION_COMMANDS[motor]
    command = forward_cmd if value >= 0 else backward_cmd
    return packet(address, command, value_to_data(value))


def stop_packet(address: int, motor: int) -> bytes:
    """Encode an explicit stop for one motor channel (data 0)."""
    return drive_packet(address, motor, 0.0)


def serial_timeout_packet(address: int, deciseconds: int) -> bytes:
    """Set the hardware serial-timeout failsafe.

    ``deciseconds`` is the timeout in 100ms units (the driver's native
    unit). ``0`` disables the failsafe. When enabled, the Sabertooth
    stops both motors if no valid packet arrives within the window —
    the hardware half of the deadman. The host keepalive (re-sending
    the last command at < timeout/2) is the other half.
    """
    return packet(address, CMD_SERIAL_TIMEOUT, max(0, min(DATA_MAX, int(deciseconds))))


def ramping_packet(address: int, value: int) -> bytes:
    """Set acceleration ramping. 0 = off; 1-10 fast; 11-20 medium;
    21-80 slow (see datasheet). Clamped to the valid 0..80 range."""
    return packet(address, CMD_RAMPING, max(0, min(80, int(value))))


def deadband_packet(address: int, value: int) -> bytes:
    """Set the command deadband half-width (0..127). Commands whose
    magnitude is within the deadband are treated as stop."""
    return packet(address, CMD_DEADBAND, max(0, min(DATA_MAX, int(value))))
