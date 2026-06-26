"""Unit tests for the MQTT-style topic matcher on runtime.bus."""
from robotlab_x.runtime.bus import is_wildcard_pattern, topic_matches_pattern


def test_exact_match():
    assert topic_matches_pattern("/clock/clock-1/tick", "/clock/clock-1/tick")
    assert not topic_matches_pattern("/clock/clock-1/tick", "/clock/clock-2/tick")


def test_single_segment_plus():
    assert topic_matches_pattern("/clock/clock-1/tick", "/clock/+/tick")
    assert topic_matches_pattern("/clock/clock-99/tick", "/clock/+/tick")
    assert not topic_matches_pattern("/clock/clock-1/state", "/clock/+/tick")
    # '+' matches exactly one segment — not zero, not many.
    assert not topic_matches_pattern("/clock/tick", "/clock/+/tick")
    assert not topic_matches_pattern("/clock/clock-1/sub/tick", "/clock/+/tick")


def test_multi_segment_hash():
    assert topic_matches_pattern("/clock/clock-1/tick", "/clock/#")
    assert topic_matches_pattern("/clock/clock-1/state", "/clock/#")
    assert topic_matches_pattern("/clock/clock-1/sub/x/y", "/clock/#")
    # '#' matches zero or more trailing segments (MQTT spec) — so the
    # parent topic itself matches its '/#' pattern.
    assert topic_matches_pattern("/clock", "/clock/#")


def test_hash_must_be_terminal():
    # Malformed: '#' anywhere but the last segment never matches.
    assert not topic_matches_pattern("/clock/clock-1/tick", "/clock/#/tick")
    assert not topic_matches_pattern("/clock/a/b", "/#/b")


def test_combined():
    assert topic_matches_pattern("/arduino/arduino-1/pin/5", "/arduino/+/pin/+")
    assert topic_matches_pattern("/arduino/arduino-1/pin/5", "/arduino/+/pin/#")
    assert not topic_matches_pattern("/arduino/arduino-1/state", "/arduino/+/pin/#")


def test_is_wildcard_pattern_detection():
    assert is_wildcard_pattern("/clock/+/tick")
    assert is_wildcard_pattern("/clock/#")
    assert is_wildcard_pattern("/#")
    assert not is_wildcard_pattern("/clock/clock-1/tick")
    assert not is_wildcard_pattern("")
