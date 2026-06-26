# unmanaged
"""Unit tests for the in-process ServoMixerService.

The mixer orchestrates ``servo`` instances over the standard
``/servo/{id}/control`` contract. These tests mock the bus (record every
publish) + save_config (no DB), seed the mixer's cached servo states, and
assert the wire-level commands it fans out — especially the synchronized-
arrival speed math (speed = distance / transition).
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict, List

import pytest

_MIXER_DIR = Path(__file__).resolve().parents[1] / "repo" / "servo_mixer" / "1.0.0"
if str(_MIXER_DIR) not in sys.path:
    sys.path.insert(0, str(_MIXER_DIR))


@pytest.fixture
def mixer(monkeypatch):
    from servo_mixer import ServoMixerService
    from robotlab_x.framework.service import ServiceMetadata

    meta = ServiceMetadata(
        proxy_id="servo_mixer-1",
        service_meta_id="servo_mixer@1.0.0",
        type_name="servo_mixer",
        type_version="1.0.0",
        tags=[],
        singleton=False,
    )
    svc = ServoMixerService(meta=meta, config={})

    published: List[Dict[str, Any]] = []
    def _publish(suffix: str, payload: Any, *, retained: bool = False) -> None:
        topic = suffix if suffix.startswith("/") else f"/servo_mixer/{svc.proxy_id}/{suffix}"
        published.append({"topic": topic, "payload": payload, "retained": retained})
    monkeypatch.setattr(svc, "publish", _publish)
    monkeypatch.setattr(svc, "save_config", lambda: None)
    svc._published = published  # type: ignore[attr-defined]
    return svc


def _cmds_to(svc, topic: str) -> List[Dict[str, Any]]:
    return [p["payload"] for p in svc._published if p["topic"] == topic]


def _seed_state(svc, **angles: int) -> None:
    """Seed cached /servo/<id>/state current_angle for the given servos."""
    for sid, ang in angles.items():
        svc._servo_states[sid] = {"current_angle": ang, "min_angle": 0, "max_angle": 180}


# ─── roster ──────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_add_remove_member(mixer):
    await mixer.m_add_member("servo-1", label="pan")
    await mixer.m_add_member("servo-2")
    assert [m.servo_id for m in mixer.config.members] == ["servo-1", "servo-2"]
    assert mixer.config.members[0].label == "pan"
    await mixer.m_remove_member("servo-1")
    assert [m.servo_id for m in mixer.config.members] == ["servo-2"]


@pytest.mark.asyncio
async def test_add_member_dedupes(mixer):
    await mixer.m_add_member("servo-1")
    await mixer.m_add_member("servo-1", label="again")
    assert len(mixer.config.members) == 1
    assert mixer.config.members[0].label == "again"


# ─── poses ───────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_capture_pose_snapshots_enabled_members(mixer):
    await mixer.m_add_member("servo-1")
    await mixer.m_add_member("servo-2")
    _seed_state(mixer, **{"servo-1": 45, "servo-2": 120})
    pose = await mixer.m_capture_pose("rest")
    assert pose["positions"] == {"servo-1": 45, "servo-2": 120}
    assert pose["name"] == "rest"
    assert mixer.config.poses[0].id == pose["id"]


@pytest.mark.asyncio
async def test_capture_pose_excludes_disabled(mixer):
    await mixer.m_add_member("servo-1")
    await mixer.m_add_member("servo-2")
    await mixer.m_set_member_enabled("servo-2", False)
    _seed_state(mixer, **{"servo-1": 45, "servo-2": 120})
    pose = await mixer.m_capture_pose("partial")
    assert pose["positions"] == {"servo-1": 45}


@pytest.mark.asyncio
async def test_apply_pose_synchronized_speed(mixer):
    await mixer.m_add_member("servo-1")
    await mixer.m_add_member("servo-2")
    _seed_state(mixer, **{"servo-1": 0, "servo-2": 90})
    await mixer.m_save_pose("wave", {"servo-1": 90, "servo-2": 90}, id="wave")
    await mixer.m_apply_pose("wave", transition_ms=1000)
    # servo-1 moves 90° in 1s → 90 deg/s; servo-2 moves 0° → clamped to 1.
    c1 = _cmds_to(mixer, "/servo/servo-1/control")[-1]
    c2 = _cmds_to(mixer, "/servo/servo-2/control")[-1]
    assert c1 == {"action": "write", "angle": 90, "speed": 90}
    assert c2 == {"action": "write", "angle": 90, "speed": 1}


@pytest.mark.asyncio
async def test_apply_pose_speed_scales_with_transition(mixer):
    await mixer.m_add_member("servo-1")
    _seed_state(mixer, **{"servo-1": 0})
    await mixer.m_save_pose("p", {"servo-1": 100}, id="p")
    await mixer.m_apply_pose("p", transition_ms=500)  # 100° / 0.5s = 200 deg/s
    assert _cmds_to(mixer, "/servo/servo-1/control")[-1]["speed"] == 200


@pytest.mark.asyncio
async def test_apply_pose_skips_disabled_members(mixer):
    await mixer.m_add_member("servo-1")
    await mixer.m_add_member("servo-2")
    await mixer.m_set_member_enabled("servo-2", False)
    _seed_state(mixer, **{"servo-1": 0, "servo-2": 0})
    await mixer.m_save_pose("p", {"servo-1": 30, "servo-2": 30}, id="p")
    await mixer.m_apply_pose("p", transition_ms=1000)
    assert _cmds_to(mixer, "/servo/servo-1/control")
    assert not _cmds_to(mixer, "/servo/servo-2/control")


@pytest.mark.asyncio
async def test_delete_pose_prunes_sequence_steps(mixer):
    await mixer.m_save_pose("a", {}, id="a")
    await mixer.m_save_sequence("seq", steps=[{"pose_id": "a", "transition_ms": 10}], id="seq")
    await mixer.m_delete_pose("a")
    assert mixer.config.poses == []
    assert mixer.config.sequences[0].steps == []


# ─── group drive ─────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_move_many(mixer):
    await mixer.m_add_member("servo-1")
    _seed_state(mixer, **{"servo-1": 0})
    await mixer.m_move_many({"servo-1": 45}, transition_ms=1000)
    assert _cmds_to(mixer, "/servo/servo-1/control")[-1] == {"action": "write", "angle": 45, "speed": 45}


@pytest.mark.asyncio
async def test_stop_all_halts_members(mixer):
    await mixer.m_add_member("servo-1")
    await mixer.m_add_member("servo-2")
    await mixer.m_stop_all()
    assert _cmds_to(mixer, "/servo/servo-1/control")[-1] == {"action": "stop"}
    assert _cmds_to(mixer, "/servo/servo-2/control")[-1] == {"action": "stop"}


# ─── sequences + player ──────────────────────────────────────────────
@pytest.mark.asyncio
async def test_sequence_crud(mixer):
    seq = await mixer.m_save_sequence("dance", steps=[{"pose_id": "a", "transition_ms": 500, "hold_ms": 200}])
    assert mixer.config.sequences[0].name == "dance"
    assert mixer.config.sequences[0].steps[0].hold_ms == 200
    await mixer.m_update_sequence(seq["id"], loop=True)
    assert mixer.config.sequences[0].loop is True
    await mixer.m_delete_sequence(seq["id"])
    assert mixer.config.sequences == []


@pytest.mark.asyncio
async def test_play_sequence_applies_pose_then_resets(mixer):
    await mixer.m_add_member("servo-1")
    _seed_state(mixer, **{"servo-1": 0})
    await mixer.m_save_pose("p", {"servo-1": 60}, id="p")
    await mixer.m_save_sequence("seq", steps=[{"pose_id": "p", "transition_ms": 10, "hold_ms": 0}], id="seq")
    await mixer.m_play_sequence("seq")
    # Let the (fast) player task finish.
    if mixer._play_task is not None:
        await mixer._play_task
    assert _cmds_to(mixer, "/servo/servo-1/control")[-1]["angle"] == 60
    snap = mixer._snapshot()
    assert snap["player"]["playing"] is False
    assert snap["player"]["current_sequence"] is None


@pytest.mark.asyncio
async def test_config_defaults(mixer):
    assert mixer.config.members == []
    assert mixer.config.poses == []
    assert mixer.config.sequences == []
    assert mixer.config.default_transition_ms == 1000
    assert mixer.config.speak_target is None


# ─── speak-in-sequence ───────────────────────────────────────────────
@pytest.mark.asyncio
async def test_set_speak_target(mixer):
    await mixer.m_set_speak_target("/chat/chat-1/control")
    assert mixer.config.speak_target == "/chat/chat-1/control"
    await mixer.m_set_speak_target(None)
    assert mixer.config.speak_target is None


@pytest.mark.asyncio
async def test_manual_speak_drives_target_and_event(mixer):
    await mixer.m_set_speak_target("/chat/chat-1/control")
    await mixer.m_speak("hello")
    assert _cmds_to(mixer, "/chat/chat-1/control")[-1] == {"action": "speak", "text": "hello"}
    assert _cmds_to(mixer, "/servo_mixer/servo_mixer-1/speak")[-1]["text"] == "hello"


@pytest.mark.asyncio
async def test_sequence_step_stores_speak(mixer):
    await mixer.m_save_pose("p", {}, id="p")
    seq = await mixer.m_save_sequence("greet", steps=[
        {"pose_id": "p", "transition_ms": 10, "speak": "hi there", "blocking": True},
    ], id="greet")
    st = mixer.config.sequences[0].steps[0]
    assert st.speak == "hi there" and st.blocking is True
    assert seq["id"] == "greet"


@pytest.mark.asyncio
async def test_play_sequence_fires_speak(mixer):
    await mixer.m_set_speak_target("/chat/chat-1/control")
    await mixer.m_save_pose("p", {}, id="p")
    await mixer.m_save_sequence("seq", steps=[
        {"pose_id": "p", "transition_ms": 10, "hold_ms": 0, "speak": "go", "blocking": False},
    ], id="seq")
    await mixer.m_play_sequence("seq")
    if mixer._play_task is not None:
        await mixer._play_task
    assert _cmds_to(mixer, "/chat/chat-1/control")[-1] == {"action": "speak", "text": "go"}
    assert _cmds_to(mixer, "/servo_mixer/servo_mixer-1/speak")


@pytest.mark.asyncio
async def test_blocking_speak_advances_on_timeout(mixer):
    # No ack ever arrives → the blocking wait falls through at the (tiny) timeout.
    await mixer.m_set_speak_timeout(10)  # 10ms
    await mixer.m_save_pose("p", {}, id="p")
    await mixer.m_save_sequence("seq", steps=[
        {"pose_id": "p", "transition_ms": 5, "speak": "wait for me", "blocking": True},
    ], id="seq")
    await mixer.m_play_sequence("seq")
    if mixer._play_task is not None:
        await mixer._play_task
    assert mixer._snapshot()["player"]["playing"] is False


# ─── timeline (keyframe animation) ───────────────────────────────────
@pytest.mark.asyncio
async def test_timeline_crud_and_keyframes(mixer):
    await mixer.m_add_member("servo-1")
    tl = await mixer.m_save_timeline("wave", duration_ms=2000)
    tid = tl["id"]
    await mixer.m_add_keyframe(tid, "servo-1", 0, angle=0)
    await mixer.m_add_keyframe(tid, "servo-1", 1000, angle=180, easing="ease_in_out")
    track = mixer.config.timelines[0].tracks[0]
    assert track.servo_id == "servo-1"
    assert [(k.t_ms, k.angle) for k in track.keyframes] == [(0, 0), (1000, 180)]
    # replace at same t_ms
    await mixer.m_add_keyframe(tid, "servo-1", 0, angle=20)
    assert mixer.config.timelines[0].tracks[0].keyframes[0].angle == 20
    # move + remove
    await mixer.m_move_keyframe(tid, "servo-1", 1000, new_t_ms=1500, new_angle=90)
    kfs = mixer.config.timelines[0].tracks[0].keyframes
    assert (kfs[-1].t_ms, kfs[-1].angle) == (1500, 90)
    await mixer.m_remove_keyframe(tid, "servo-1", 0)
    assert [k.t_ms for k in mixer.config.timelines[0].tracks[0].keyframes] == [1500]


@pytest.mark.asyncio
async def test_add_keyframe_defaults_to_current_angle(mixer):
    await mixer.m_add_member("servo-1")
    _seed_state(mixer, **{"servo-1": 73})
    tl = await mixer.m_save_timeline("t")
    kf = await mixer.m_add_keyframe(tl["id"], "servo-1", 500)  # no angle → capture
    assert kf["angle"] == 73


def test_interp_track_eases_between_keyframes(mixer):
    from servo_mixer import TimelineTrack, Keyframe
    track = TimelineTrack(servo_id="servo-1", keyframes=[
        Keyframe(t_ms=0, angle=0, easing="linear"),
        Keyframe(t_ms=1000, angle=100, easing="linear"),
    ])
    assert mixer._interp_track(track, -10) == 0      # held before first
    assert mixer._interp_track(track, 500) == 50      # linear midpoint
    assert mixer._interp_track(track, 2000) == 100    # held after last


def test_interp_track_ease_in_out_midpoint(mixer):
    from servo_mixer import TimelineTrack, Keyframe
    track = TimelineTrack(servo_id="s", keyframes=[
        Keyframe(t_ms=0, angle=0, easing="ease_in_out"),
        Keyframe(t_ms=1000, angle=100, easing="ease_in_out"),
    ])
    # smoothstep(0.5) = 0.5 → still 50 at the midpoint, but biased near ends
    assert mixer._interp_track(track, 500) == 50
    assert mixer._interp_track(track, 250) < 25       # eased-in: slower start


@pytest.mark.asyncio
async def test_seek_applies_snap_frame(mixer):
    await mixer.m_add_member("servo-1")
    tl = await mixer.m_save_timeline("t", duration_ms=1000)
    await mixer.m_add_keyframe(tl["id"], "servo-1", 0, angle=0)
    await mixer.m_add_keyframe(tl["id"], "servo-1", 1000, angle=100)
    await mixer.m_seek(tl["id"], 500)
    cmd = _cmds_to(mixer, "/servo/servo-1/control")[-1]
    assert cmd["action"] == "write" and cmd["angle"] == 50 and cmd["speed"] == 360
    assert mixer._snapshot()["player"]["playhead_ms"] == 500


@pytest.mark.asyncio
async def test_play_timeline_runs_and_resets(mixer):
    await mixer.m_add_member("servo-1")
    tl = await mixer.m_save_timeline("t", duration_ms=60, loop=False)  # ~2 frames @30Hz
    await mixer.m_add_keyframe(tl["id"], "servo-1", 0, angle=0)
    await mixer.m_add_keyframe(tl["id"], "servo-1", 60, angle=30)
    await mixer.m_play_timeline(tl["id"])
    if mixer._play_task is not None:
        await mixer._play_task
    # at least one frame drove the servo
    assert _cmds_to(mixer, "/servo/servo-1/control")
    snap = mixer._snapshot()
    assert snap["player"]["playing"] is False
    assert snap["player"]["current_timeline"] is None


@pytest.mark.asyncio
async def test_blocking_speak_released_by_ack(mixer):
    # A speak_done ack releases the blocking wait before the (long) timeout.
    await mixer.m_set_speak_timeout(60000)  # 60s — would hang without the ack
    await mixer.m_save_pose("p", {}, id="p")
    await mixer.m_save_sequence("seq", steps=[
        {"pose_id": "p", "transition_ms": 1, "speak": "done?", "blocking": True},
    ], id="seq")
    await mixer.m_play_sequence("seq")
    # Simulate the speech consumer acking completion.
    import asyncio as _aio
    await _aio.sleep(0.05)
    mixer._speak_done.set()
    await _aio.wait_for(mixer._play_task, timeout=2.0)
    assert mixer._snapshot()["player"]["playing"] is False
