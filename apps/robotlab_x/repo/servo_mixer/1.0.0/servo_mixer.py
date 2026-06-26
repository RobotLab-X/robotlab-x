# unmanaged
"""ServoMixerService — orchestrate a collection of servos.

A choreography surface over N ``servo`` services. Three layers, all built
on the standard ``/servo/{id}`` bus contract (no hardware, no deps):

  * MIXING BOARD (live drive) — the UI shows one fader per member servo;
    faders publish straight to ``/servo/{id}/control`` for snappy dragging.
    The mixer offers ``move_many`` / ``stop_all`` for programmatic group use.
  * POSES — named snapshots of member angles ({servo_id: angle}). Capture
    reads current angles off the members' /state; Apply moves every member
    toward the pose so they ARRIVE TOGETHER (per-servo speed = distance /
    transition, delegated to each servo's own interpolation loop).
  * SEQUENCES — ordered poses with per-step transition + hold (+ loop). A
    backend player steps through them; pause/stop are cooperative.

Discovery: the mixer subscribes the wildcard ``/servo/+/state`` and caches
each servo's latest snapshot (current_angle, min/max). That cache feeds
pose capture and the synchronized-arrival math. The roster (which servos
are members) + poses + sequences persist in config across restarts.

Bus topics:
  /servo_mixer/{id}/state    retained — members + poses + sequences + player
  /servo_mixer/{id}/control  incoming actions

This file deliberately avoids ``from __future__ import annotations`` — like
servo.py, it's loaded in-process via importlib, and Pydantic v2 resolves
hints against the module dict, which breaks with stringified annotations.

Extensibility (designed-in, not built): a sequence is a discretized
timeline — ``transition_ms`` is the gap between keyframe columns and each
step carries an ``easing`` field (only "linear" honored in v1). A Bottango-
style per-servo timeline/keyframe editor is a future view over this same
data; true eased GROUP motion would swap the per-servo-speed delegation for
a mixer-driven frame loop without reshaping the model.
"""
import asyncio
import logging
import re
import time
import uuid
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field
from rlx_bus import ServiceConfig
from robotlab_x.framework import Service, service_method

logger = logging.getLogger(__name__)

_SERVO_STATE_RE = re.compile(r"^/servo/([^/]+)/state$")
_SPEED_MIN, _SPEED_MAX = 1, 360


def _slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", str(name or "").lower()).strip("-")
    return s or "item"


def _ease(kind: str, u: float) -> float:
    """Map a 0..1 segment progress through an easing curve."""
    u = 0.0 if u < 0 else (1.0 if u > 1 else u)
    if kind == "ease_in":
        return u * u
    if kind == "ease_out":
        return 1.0 - (1.0 - u) * (1.0 - u)
    if kind == "ease_in_out":
        return u * u * (3.0 - 2.0 * u)  # smoothstep
    return u  # linear


class MemberModel(BaseModel):
    servo_id: str
    label: Optional[str] = None
    enabled: bool = True


class PoseModel(BaseModel):
    id: str
    name: str
    # servo_id -> angle. May be a SUBSET of members (ad-hoc grouping).
    positions: Dict[str, int] = Field(default_factory=dict)


class SeqStep(BaseModel):
    pose_id: str
    transition_ms: int = Field(1000, ge=0, description="Move time to reach the pose.")
    hold_ms: int = Field(0, ge=0, description="Dwell after arriving, before the next step.")
    easing: str = Field("linear", description="Reserved; only 'linear' honored in v1.")
    speak: Optional[str] = Field(None, description="Optional text spoken when the step runs (via the mixer's speak_target).")
    blocking: bool = Field(False, description="When True + speak set, the sequence waits for a /speak_done ack (or speak_timeout_ms) before advancing.")


class SequenceModel(BaseModel):
    id: str
    name: str
    loop: bool = False
    steps: List[SeqStep] = Field(default_factory=list)


# ─── timeline (Bottango-style) ───────────────────────────────────────
class Keyframe(BaseModel):
    t_ms: int = Field(0, ge=0, description="Time along the timeline.")
    angle: int = Field(90, description="Servo angle at this time.")
    # ``easing`` governs the segment LEAVING this keyframe (kf → next).
    easing: str = Field("linear", description="linear | ease_in | ease_out | ease_in_out")


class TimelineTrack(BaseModel):
    servo_id: str
    keyframes: List[Keyframe] = Field(default_factory=list)


class TimelineModel(BaseModel):
    """A per-servo keyframe animation. Unlike a sequence (shared pose
    columns), each track keyframes independently; the player interpolates
    every member each frame with per-segment easing."""
    id: str
    name: str
    duration_ms: int = Field(4000, ge=1)
    loop: bool = False
    tracks: List[TimelineTrack] = Field(default_factory=list)


class ServoMixerConfig(ServiceConfig):
    """Persisted roster + choreography. Survives restarts."""
    members: List[MemberModel] = Field(default_factory=list)
    poses: List[PoseModel] = Field(default_factory=list)
    sequences: List[SequenceModel] = Field(default_factory=list)
    timelines: List[TimelineModel] = Field(default_factory=list)
    default_transition_ms: int = Field(1000, ge=0, description="Default move time when a pose/step doesn't specify one.")
    speak_target: Optional[str] = Field(None, description="Bus control topic a step's `speak` text is sent to as {action:'speak', text}, e.g. '/chat/chat-1/control'. Empty = speech events are still published on /servo_mixer/{id}/speak but nothing is driven.")
    speak_timeout_ms: int = Field(8000, ge=0, description="Max wait for a /servo_mixer/{id}/speak_done ack on a blocking speak step before advancing anyway.")


class ServoMixerService(Service):
    """In-process servo choreographer. See module docstring for the model."""

    config_class = ServoMixerConfig
    publishes = ["state", "speak"]

    _control_task: Optional[asyncio.Task] = None
    _watch_task: Optional[asyncio.Task] = None
    _speak_watch_task: Optional[asyncio.Task] = None
    _play_task: Optional[asyncio.Task] = None

    def __init__(self, meta, config) -> None:
        super().__init__(meta=meta, config=config)
        # Instance state initialized here (not on_start) so @service_method
        # handlers are safe to call before the service is started — the
        # test harness exercises them directly, and a method could arrive
        # on the bus before on_start finishes.
        # Latest /state snapshot per servo proxy id (members + others).
        self._servo_states: Dict[str, Dict[str, Any]] = {}
        self._playing = False
        self._paused = False
        self._stop_requested = False
        self._cur_seq: Optional[str] = None
        self._cur_step = -1
        self._cur_timeline: Optional[str] = None
        self._playhead_ms = 0
        self._tl_last: Dict[str, int] = {}  # last angle sent per servo during timeline play
        self._last_error: Optional[str] = None
        # Set by an external consumer's /servo_mixer/{id}/speak_done ack;
        # gates a blocking speak step (bounded by speak_timeout_ms).
        self._speak_done = asyncio.Event()

    # ─── lifecycle ───────────────────────────────────────────────────
    async def on_start(self) -> None:
        await self._publish_state()
        self._watch_task = asyncio.create_task(self._watch_servos())
        self._speak_watch_task = asyncio.create_task(self._watch_speak_done())
        self._control_task = asyncio.create_task(self._control_loop())

    async def on_stop(self) -> None:
        self._stop_requested = True
        tasks = (self._play_task, self._watch_task, self._speak_watch_task, self._control_task)
        for task in tasks:
            if task is not None and not task.done():
                task.cancel()
        await asyncio.gather(*(t for t in tasks if t is not None), return_exceptions=True)

    async def _watch_speak_done(self) -> None:
        """Any message on /servo_mixer/{id}/speak_done releases a blocking
        speak step. A TTS/speech consumer publishes it when it finishes."""
        async for _ in self.subscribe_iter("speak_done"):
            self._speak_done.set()

    async def _watch_servos(self) -> None:
        """Cache every servo's latest /state (members + discoverable
        others). Silent — the UI reads live member angles straight from
        the servos; the mixer cache only feeds capture + sync math."""
        async for msg in self.subscribe_iter("/servo/+/state"):
            m = _SERVO_STATE_RE.match(getattr(msg, "topic", "") or "")
            if not m:
                continue
            payload = getattr(msg, "payload", None)
            if isinstance(payload, dict):
                self._servo_states[m.group(1)] = payload

    # ─── helpers ─────────────────────────────────────────────────────
    def _member_ids(self) -> List[str]:
        return [m.servo_id for m in self.config.members]

    def _gen_id(self, name: str, existing: List[str]) -> str:
        base = _slug(name)
        if base not in existing:
            return base
        return f"{base}-{uuid.uuid4().hex[:6]}"

    def _save(self, patch: Dict[str, Any]) -> None:
        self.config = self.config.merge_dict(patch)
        self.save_config()

    def _control_topic(self, servo_id: str) -> str:
        return f"/servo/{servo_id}/control"

    def _send(self, servo_id: str, payload: Dict[str, Any]) -> None:
        self.publish(self._control_topic(servo_id), payload)

    def _enabled_member_ids(self) -> List[str]:
        return [m.servo_id for m in self.config.members if m.enabled]

    def _apply_positions(self, positions: Dict[str, int], transition_ms: int) -> None:
        """Fan out one ``write`` per member so they ARRIVE TOGETHER.

        speed_i = |Δangle_i| / transition_s, clamped to the servo's
        [1, 360] deg/s range. A near-zero transition pins speed at the
        cap (a fast snap). Members not in ``positions`` (or disabled)
        stay put."""
        enabled = set(self._enabled_member_ids())
        transition_s = max(0.001, transition_ms / 1000.0)
        for servo_id, target in positions.items():
            if servo_id not in enabled:
                continue
            target = int(target)
            cur = self._servo_states.get(servo_id, {}).get("current_angle")
            cur = int(cur) if isinstance(cur, (int, float)) else target
            dist = abs(target - cur)
            speed = max(_SPEED_MIN, min(_SPEED_MAX, round(dist / transition_s)))
            self._send(servo_id, {"action": "write", "angle": target, "speed": speed})

    # ─── timeline interpolation ───────────────────────────────────────
    _TL_FRAME_HZ = 30.0

    def _interp_track(self, track: "TimelineTrack", t_ms: float) -> Optional[int]:
        """Angle of one track at time ``t_ms`` — held at the ends, eased
        between bracketing keyframes (the LEAVING keyframe's easing)."""
        kfs = sorted(track.keyframes, key=lambda k: k.t_ms)
        if not kfs:
            return None
        if t_ms <= kfs[0].t_ms:
            return int(kfs[0].angle)
        if t_ms >= kfs[-1].t_ms:
            return int(kfs[-1].angle)
        for a, b in zip(kfs, kfs[1:]):
            if a.t_ms <= t_ms <= b.t_ms:
                span = b.t_ms - a.t_ms
                u = 0.0 if span <= 0 else (t_ms - a.t_ms) / span
                e = _ease(a.easing, u)
                return int(round(a.angle + (b.angle - a.angle) * e))
        return int(kfs[-1].angle)

    def _apply_timeline_frame(self, tl: "TimelineModel", t_ms: float, frame_dt: float,
                              *, snap: bool = False) -> None:
        """Send one frame: each enabled track's interpolated angle. Per-
        frame speed = Δ / frame_dt so the servo tracks the local rate (a
        ``snap`` frame — used by seek — jumps at max speed)."""
        enabled = set(self._enabled_member_ids())
        for track in tl.tracks:
            if track.servo_id not in enabled:
                continue
            ang = self._interp_track(track, t_ms)
            if ang is None:
                continue
            last = self._tl_last.get(track.servo_id)
            if last is not None and ang == last and not snap:
                continue  # no change — skip the packet
            if snap or last is None:
                speed = _SPEED_MAX
            else:
                speed = max(_SPEED_MIN, min(_SPEED_MAX, round(abs(ang - last) / max(0.001, frame_dt))))
            self._send(track.servo_id, {"action": "write", "angle": int(ang), "speed": speed})
            self._tl_last[track.servo_id] = ang

    async def _play_timeline_loop(self, tl: "TimelineModel") -> None:
        self._playing = True
        self._cur_timeline = tl.id
        self._cur_seq = None
        self._tl_last = {}
        await self._publish_state()
        frame_dt = 1.0 / self._TL_FRAME_HZ
        frame_i = 0
        try:
            while not self._stop_requested:
                t = 0.0
                while t <= tl.duration_ms and not self._stop_requested:
                    while self._paused and not self._stop_requested:
                        await asyncio.sleep(0.1)
                    if self._stop_requested:
                        break
                    self._playhead_ms = int(t)
                    self._apply_timeline_frame(tl, t, frame_dt)
                    frame_i += 1
                    if frame_i % 6 == 0:  # ~5Hz state publishes
                        await self._publish_state()
                    await asyncio.sleep(frame_dt)
                    t += frame_dt * 1000.0
                if not tl.loop:
                    break
        finally:
            self._playing = False
            self._cur_timeline = None
            self._playhead_ms = 0
            self._tl_last = {}
            await self._publish_state()

    async def _interruptible_sleep(self, seconds: float) -> None:
        """Sleep in small chunks so a stop request lands promptly."""
        end = max(0.0, seconds)
        step = 0.05
        elapsed = 0.0
        while elapsed < end:
            if self._stop_requested:
                return
            await asyncio.sleep(min(step, end - elapsed))
            elapsed += step

    # ─── roster ──────────────────────────────────────────────────────
    @service_method("add_member", publishes=["state"])
    async def m_add_member(self, servo_id: str, label: Optional[str] = None) -> Dict[str, Any]:
        sid = str(servo_id)
        members = [m for m in self.config.members if m.servo_id != sid]
        members.append(MemberModel(servo_id=sid, label=label))
        self._save({"members": [m.model_dump() for m in members]})
        await self._publish_state()
        return self._snapshot()

    @service_method("remove_member", publishes=["state"])
    async def m_remove_member(self, servo_id: str) -> Dict[str, Any]:
        sid = str(servo_id)
        members = [m for m in self.config.members if m.servo_id != sid]
        self._save({"members": [m.model_dump() for m in members]})
        await self._publish_state()
        return self._snapshot()

    @service_method("set_member_label", publishes=["state"])
    async def m_set_member_label(self, servo_id: str, label: Optional[str] = None) -> Dict[str, Any]:
        sid = str(servo_id)
        members = []
        for m in self.config.members:
            if m.servo_id == sid:
                m = MemberModel(servo_id=sid, label=label, enabled=m.enabled)
            members.append(m)
        self._save({"members": [m.model_dump() for m in members]})
        await self._publish_state()
        return self._snapshot()

    @service_method("set_member_enabled", publishes=["state"])
    async def m_set_member_enabled(self, servo_id: str, enabled: bool = True) -> Dict[str, Any]:
        sid = str(servo_id)
        members = []
        for m in self.config.members:
            if m.servo_id == sid:
                m = MemberModel(servo_id=sid, label=m.label, enabled=bool(enabled))
            members.append(m)
        self._save({"members": [m.model_dump() for m in members]})
        await self._publish_state()
        return self._snapshot()

    @service_method("set_default_transition", publishes=["state"])
    async def m_set_default_transition(self, transition_ms: int) -> Dict[str, Any]:
        self._save({"default_transition_ms": max(0, int(transition_ms))})
        await self._publish_state()
        return {"default_transition_ms": self.config.default_transition_ms}

    @service_method("set_speak_target", publishes=["state"])
    async def m_set_speak_target(self, topic: Optional[str] = None) -> Dict[str, Any]:
        """Set the control topic a step's `speak` text is sent to, e.g.
        '/chat/chat-1/control'. Empty disables driving (events still fire)."""
        self._save({"speak_target": (str(topic) if topic else None)})
        await self._publish_state()
        return {"speak_target": self.config.speak_target}

    @service_method("set_speak_timeout", publishes=["state"])
    async def m_set_speak_timeout(self, speak_timeout_ms: int) -> Dict[str, Any]:
        self._save({"speak_timeout_ms": max(0, int(speak_timeout_ms))})
        await self._publish_state()
        return {"speak_timeout_ms": self.config.speak_timeout_ms}

    @service_method("speak")
    async def m_speak(self, text: str) -> Dict[str, Any]:
        """Fire one speech now (manual test / external trigger). Non-blocking."""
        self._fire_speak(SeqStep(pose_id="", speak=str(text)))
        return {"spoke": str(text)}

    # ─── group drive ─────────────────────────────────────────────────
    @service_method("move_many", publishes=["/servo/{servo_id}/control"])
    async def m_move_many(self, positions: Dict[str, int], transition_ms: Optional[int] = None) -> Dict[str, Any]:
        """Move several members at once with synchronized arrival."""
        t = self.config.default_transition_ms if transition_ms is None else int(transition_ms)
        self._apply_positions({str(k): int(v) for k, v in (positions or {}).items()}, t)
        return {"moved": list((positions or {}).keys()), "transition_ms": t}

    @service_method("stop_all")
    async def m_stop_all(self) -> Dict[str, Any]:
        """Emergency stop — halt every member where it is + stop the player."""
        self._request_stop()
        for sid in self._member_ids():
            self._send(sid, {"action": "stop"})
        await self._publish_state()
        return {"stopped": self._member_ids()}

    @service_method("relax_all")
    async def m_relax_all(self) -> Dict[str, Any]:
        """Detach every member (release torque)."""
        for sid in self._member_ids():
            self._send(sid, {"action": "detach"})
        return {"relaxed": self._member_ids()}

    # ─── poses ───────────────────────────────────────────────────────
    @service_method("capture_pose", publishes=["state"])
    async def m_capture_pose(self, name: str, id: Optional[str] = None) -> Dict[str, Any]:
        """Snapshot current angles of all enabled members into a new pose."""
        positions: Dict[str, int] = {}
        for sid in self._enabled_member_ids():
            cur = self._servo_states.get(sid, {}).get("current_angle")
            if isinstance(cur, (int, float)):
                positions[sid] = int(cur)
        pid = str(id) if id else self._gen_id(name, [p.id for p in self.config.poses])
        pose = PoseModel(id=pid, name=str(name), positions=positions)
        poses = [p for p in self.config.poses if p.id != pid] + [pose]
        self._save({"poses": [p.model_dump() for p in poses]})
        await self._publish_state()
        return pose.model_dump()

    @service_method("save_pose", publishes=["state"])
    async def m_save_pose(self, name: str, positions: Dict[str, int],
                          id: Optional[str] = None) -> Dict[str, Any]:
        """Create or replace a pose with explicit positions."""
        pid = str(id) if id else self._gen_id(name, [p.id for p in self.config.poses])
        pose = PoseModel(id=pid, name=str(name),
                         positions={str(k): int(v) for k, v in (positions or {}).items()})
        poses = [p for p in self.config.poses if p.id != pid] + [pose]
        self._save({"poses": [p.model_dump() for p in poses]})
        await self._publish_state()
        return pose.model_dump()

    @service_method("update_pose", publishes=["state"])
    async def m_update_pose(self, id: str, positions: Optional[Dict[str, int]] = None,
                            name: Optional[str] = None) -> Dict[str, Any]:
        pid = str(id)
        poses = []
        found = None
        for p in self.config.poses:
            if p.id == pid:
                p = PoseModel(
                    id=pid,
                    name=str(name) if name is not None else p.name,
                    positions={str(k): int(v) for k, v in positions.items()} if positions is not None else p.positions,
                )
                found = p
            poses.append(p)
        if found is None:
            raise ValueError(f"no pose {pid!r}")
        self._save({"poses": [p.model_dump() for p in poses]})
        await self._publish_state()
        return found.model_dump()

    @service_method("delete_pose", publishes=["state"])
    async def m_delete_pose(self, id: str) -> Dict[str, Any]:
        pid = str(id)
        poses = [p for p in self.config.poses if p.id != pid]
        # Drop steps that referenced the deleted pose so sequences stay valid.
        sequences = []
        for s in self.config.sequences:
            steps = [st for st in s.steps if st.pose_id != pid]
            sequences.append(SequenceModel(id=s.id, name=s.name, loop=s.loop, steps=steps))
        self._save({"poses": [p.model_dump() for p in poses],
                    "sequences": [s.model_dump() for s in sequences]})
        await self._publish_state()
        return {"deleted": pid}

    @service_method("apply_pose", publishes=["/servo/{servo_id}/control", "state"])
    async def m_apply_pose(self, id: str, transition_ms: Optional[int] = None) -> Dict[str, Any]:
        """Move all members toward the pose (synchronized arrival)."""
        pid = str(id)
        pose = next((p for p in self.config.poses if p.id == pid), None)
        if pose is None:
            raise ValueError(f"no pose {pid!r}")
        t = self.config.default_transition_ms if transition_ms is None else int(transition_ms)
        self._apply_positions(dict(pose.positions), t)
        return {"applied": pid, "transition_ms": t, "members": list(pose.positions.keys())}

    # ─── sequences ───────────────────────────────────────────────────
    @service_method("save_sequence", publishes=["state"])
    async def m_save_sequence(self, name: str, steps: Optional[List[Dict[str, Any]]] = None,
                              loop: bool = False, id: Optional[str] = None) -> Dict[str, Any]:
        sid = str(id) if id else self._gen_id(name, [s.id for s in self.config.sequences])
        seq = SequenceModel(id=sid, name=str(name), loop=bool(loop),
                            steps=[SeqStep(**st) for st in (steps or [])])
        sequences = [s for s in self.config.sequences if s.id != sid] + [seq]
        self._save({"sequences": [s.model_dump() for s in sequences]})
        await self._publish_state()
        return seq.model_dump()

    @service_method("update_sequence", publishes=["state"])
    async def m_update_sequence(self, id: str, name: Optional[str] = None,
                                steps: Optional[List[Dict[str, Any]]] = None,
                                loop: Optional[bool] = None) -> Dict[str, Any]:
        sid = str(id)
        sequences = []
        found = None
        for s in self.config.sequences:
            if s.id == sid:
                s = SequenceModel(
                    id=sid,
                    name=str(name) if name is not None else s.name,
                    loop=bool(loop) if loop is not None else s.loop,
                    steps=[SeqStep(**st) for st in steps] if steps is not None else s.steps,
                )
                found = s
            sequences.append(s)
        if found is None:
            raise ValueError(f"no sequence {sid!r}")
        self._save({"sequences": [s.model_dump() for s in sequences]})
        await self._publish_state()
        return found.model_dump()

    @service_method("delete_sequence", publishes=["state"])
    async def m_delete_sequence(self, id: str) -> Dict[str, Any]:
        sid = str(id)
        sequences = [s for s in self.config.sequences if s.id != sid]
        self._save({"sequences": [s.model_dump() for s in sequences]})
        await self._publish_state()
        return {"deleted": sid}

    # ─── timelines (keyframe animation) ──────────────────────────────
    def _save_timeline(self, tl: "TimelineModel") -> None:
        timelines = [t for t in self.config.timelines if t.id != tl.id] + [tl]
        self._save({"timelines": [t.model_dump() for t in timelines]})

    def _find_timeline(self, tid: str) -> "TimelineModel":
        tl = next((t for t in self.config.timelines if t.id == tid), None)
        if tl is None:
            raise ValueError(f"no timeline {tid!r}")
        return tl

    @service_method("save_timeline", publishes=["state"])
    async def m_save_timeline(self, name: str, duration_ms: int = 4000, loop: bool = False,
                              tracks: Optional[List[Dict[str, Any]]] = None,
                              id: Optional[str] = None) -> Dict[str, Any]:
        tid = str(id) if id else self._gen_id(name, [t.id for t in self.config.timelines])
        tl = TimelineModel(id=tid, name=str(name), duration_ms=max(1, int(duration_ms)),
                           loop=bool(loop), tracks=[TimelineTrack(**tr) for tr in (tracks or [])])
        self._save_timeline(tl)
        await self._publish_state()
        return tl.model_dump()

    @service_method("update_timeline", publishes=["state"])
    async def m_update_timeline(self, id: str, name: Optional[str] = None,
                                duration_ms: Optional[int] = None,
                                loop: Optional[bool] = None) -> Dict[str, Any]:
        tl = self._find_timeline(str(id))
        tl = TimelineModel(
            id=tl.id,
            name=str(name) if name is not None else tl.name,
            duration_ms=max(1, int(duration_ms)) if duration_ms is not None else tl.duration_ms,
            loop=bool(loop) if loop is not None else tl.loop,
            tracks=tl.tracks,
        )
        self._save_timeline(tl)
        await self._publish_state()
        return tl.model_dump()

    @service_method("delete_timeline", publishes=["state"])
    async def m_delete_timeline(self, id: str) -> Dict[str, Any]:
        tid = str(id)
        timelines = [t for t in self.config.timelines if t.id != tid]
        self._save({"timelines": [t.model_dump() for t in timelines]})
        await self._publish_state()
        return {"deleted": tid}

    @service_method("add_keyframe", publishes=["state"])
    async def m_add_keyframe(self, timeline_id: str, servo_id: str, t_ms: int,
                             angle: Optional[int] = None, easing: str = "linear") -> Dict[str, Any]:
        """Add/replace a keyframe on a track at ``t_ms``. ``angle`` defaults
        to the member's current cached angle (capture-at-playhead)."""
        tl = self._find_timeline(str(timeline_id))
        sid = str(servo_id)
        if angle is None:
            cur = self._servo_states.get(sid, {}).get("current_angle")
            angle = int(cur) if isinstance(cur, (int, float)) else 90
        kf = Keyframe(t_ms=max(0, int(t_ms)), angle=int(angle), easing=str(easing))
        tracks = [TimelineTrack(servo_id=t.servo_id, keyframes=list(t.keyframes)) for t in tl.tracks]
        track = next((t for t in tracks if t.servo_id == sid), None)
        if track is None:
            track = TimelineTrack(servo_id=sid, keyframes=[])
            tracks.append(track)
        track.keyframes = sorted(
            [k for k in track.keyframes if k.t_ms != kf.t_ms] + [kf], key=lambda k: k.t_ms)
        self._save_timeline(TimelineModel(id=tl.id, name=tl.name, duration_ms=tl.duration_ms,
                                          loop=tl.loop, tracks=tracks))
        await self._publish_state()
        return kf.model_dump()

    @service_method("remove_keyframe", publishes=["state"])
    async def m_remove_keyframe(self, timeline_id: str, servo_id: str, t_ms: int) -> Dict[str, Any]:
        tl = self._find_timeline(str(timeline_id))
        sid = str(servo_id)
        tracks = []
        for t in tl.tracks:
            if t.servo_id == sid:
                kfs = [k for k in t.keyframes if k.t_ms != int(t_ms)]
                if not kfs:
                    continue  # drop an emptied track
                t = TimelineTrack(servo_id=sid, keyframes=kfs)
            tracks.append(t)
        self._save_timeline(TimelineModel(id=tl.id, name=tl.name, duration_ms=tl.duration_ms,
                                          loop=tl.loop, tracks=tracks))
        await self._publish_state()
        return {"removed": {"servo_id": sid, "t_ms": int(t_ms)}}

    @service_method("move_keyframe", publishes=["state"])
    async def m_move_keyframe(self, timeline_id: str, servo_id: str, t_ms: int,
                              new_t_ms: Optional[int] = None, new_angle: Optional[int] = None,
                              easing: Optional[str] = None) -> Dict[str, Any]:
        """Edit a keyframe in place (drag): change its time, angle, easing."""
        tl = self._find_timeline(str(timeline_id))
        sid = str(servo_id)
        tracks = []
        moved = None
        for t in tl.tracks:
            if t.servo_id == sid:
                kfs = []
                for k in t.keyframes:
                    if k.t_ms == int(t_ms):
                        k = Keyframe(
                            t_ms=max(0, int(new_t_ms)) if new_t_ms is not None else k.t_ms,
                            angle=int(new_angle) if new_angle is not None else k.angle,
                            easing=str(easing) if easing is not None else k.easing,
                        )
                        moved = k
                    kfs.append(k)
                t = TimelineTrack(servo_id=sid, keyframes=sorted(kfs, key=lambda k: k.t_ms))
            tracks.append(t)
        self._save_timeline(TimelineModel(id=tl.id, name=tl.name, duration_ms=tl.duration_ms,
                                          loop=tl.loop, tracks=tracks))
        await self._publish_state()
        return moved.model_dump() if moved else {}

    @service_method("seek", publishes=["/servo/{servo_id}/control", "state"])
    async def m_seek(self, timeline_id: str, t_ms: int) -> Dict[str, Any]:
        """Scrub: jump the playhead to ``t_ms`` and apply that frame once."""
        tl = self._find_timeline(str(timeline_id))
        self._tl_last = {}  # force a snap to the scrubbed pose
        self._playhead_ms = max(0, int(t_ms))
        self._apply_timeline_frame(tl, float(self._playhead_ms), 1.0 / self._TL_FRAME_HZ, snap=True)
        await self._publish_state()
        return {"timeline": tl.id, "playhead_ms": self._playhead_ms}

    @service_method("play_timeline", publishes=["/servo/{servo_id}/control", "state"])
    async def m_play_timeline(self, id: str) -> Dict[str, Any]:
        tl = self._find_timeline(str(id))
        await self._cancel_play()
        self._stop_requested = False
        self._paused = False
        self._play_task = asyncio.create_task(self._play_timeline_loop(tl))
        return {"playing": tl.id}

    # ─── player ──────────────────────────────────────────────────────
    @service_method("play_pose", publishes=["/servo/{servo_id}/control", "state"])
    async def m_play_pose(self, id: str, transition_ms: Optional[int] = None) -> Dict[str, Any]:
        return await self.m_apply_pose(id, transition_ms)

    @service_method("play_sequence", publishes=["/servo/{servo_id}/control", "state"])
    async def m_play_sequence(self, id: str) -> Dict[str, Any]:
        sid = str(id)
        seq = next((s for s in self.config.sequences if s.id == sid), None)
        if seq is None:
            raise ValueError(f"no sequence {sid!r}")
        await self._cancel_play()
        self._stop_requested = False
        self._paused = False
        self._play_task = asyncio.create_task(self._play_loop(seq))
        return {"playing": sid}

    @service_method("pause", publishes=["state"])
    async def m_pause(self) -> Dict[str, Any]:
        self._paused = True
        await self._publish_state()
        return {"paused": True}

    @service_method("resume", publishes=["state"])
    async def m_resume(self) -> Dict[str, Any]:
        self._paused = False
        await self._publish_state()
        return {"paused": False}

    @service_method("stop", publishes=["state"])
    async def m_stop(self) -> Dict[str, Any]:
        """Stop the player + halt members where they are."""
        self._request_stop()
        for sid in self._member_ids():
            self._send(sid, {"action": "stop"})
        await self._publish_state()
        return {"stopped": True}

    def _request_stop(self) -> None:
        self._stop_requested = True
        self._paused = False
        # Release any in-flight blocking-speak wait so the player exits promptly.
        self._speak_done.set()

    def _fire_speak(self, step: "SeqStep") -> bool:
        """Emit a step's speech: publish the observable event on
        /servo_mixer/{id}/speak and, if a speak_target is configured, drive
        it with {action:'speak', text}. Returns True when text was spoken."""
        text = (step.speak or "").strip()
        if not text:
            return False
        if step.blocking:
            self._speak_done.clear()
        self.publish("speak", {
            "text": text, "blocking": bool(step.blocking),
            "sequence": self._cur_seq, "step": self._cur_step, "ts": time.time(),
        })
        if self.config.speak_target:
            self.publish(self.config.speak_target, {"action": "speak", "text": text})
        return True

    async def _cancel_play(self) -> None:
        self._request_stop()
        task = self._play_task
        if task is not None and not task.done():
            try:
                await task
            except Exception:  # noqa: BLE001
                logger.exception("servo_mixer %s: play task raised on cancel", self.proxy_id)
        self._play_task = None

    async def _play_loop(self, seq: SequenceModel) -> None:
        self._playing = True
        self._cur_seq = seq.id
        self._cur_step = -1
        await self._publish_state()
        try:
            while not self._stop_requested:
                for i, step in enumerate(seq.steps):
                    if self._stop_requested:
                        return
                    # Pause takes effect at step boundaries (v1) — members
                    # hold their last commanded position while paused.
                    while self._paused and not self._stop_requested:
                        await asyncio.sleep(0.1)
                    if self._stop_requested:
                        return
                    self._cur_step = i
                    await self._publish_state()
                    # Speech fires at step start so it overlaps the move.
                    spoke = self._fire_speak(step)
                    pose = next((p for p in self.config.poses if p.id == step.pose_id), None)
                    if pose is not None:
                        self._apply_positions(dict(pose.positions), step.transition_ms)
                    await self._interruptible_sleep((step.transition_ms + step.hold_ms) / 1000.0)
                    # Blocking step: don't advance until the speech acks (or
                    # speak_timeout_ms elapses). The move+hold already ran, so
                    # this only adds wait when speech outlasts the motion.
                    if spoke and step.blocking and not self._stop_requested:
                        try:
                            await asyncio.wait_for(
                                self._speak_done.wait(),
                                timeout=max(0.0, self.config.speak_timeout_ms / 1000.0),
                            )
                        except asyncio.TimeoutError:
                            pass
                if not seq.loop:
                    break
        finally:
            self._playing = False
            self._cur_step = -1
            self._cur_seq = None
            await self._publish_state()

    # ─── state ───────────────────────────────────────────────────────
    def _snapshot(self) -> Dict[str, Any]:
        members = []
        for m in self.config.members:
            st = self._servo_states.get(m.servo_id, {})
            members.append({
                "servo_id": m.servo_id,
                "label": m.label or m.servo_id,
                "enabled": m.enabled,
                "online": m.servo_id in self._servo_states,
                "current_angle": st.get("current_angle"),
                "angle": st.get("angle"),
                "min_angle": st.get("min_angle", 0),
                "max_angle": st.get("max_angle", 180),
            })
        return {
            "members": members,
            "poses": [p.model_dump() for p in self.config.poses],
            "sequences": [s.model_dump() for s in self.config.sequences],
            "timelines": [t.model_dump() for t in self.config.timelines],
            "default_transition_ms": self.config.default_transition_ms,
            "speak_target": self.config.speak_target,
            "speak_timeout_ms": self.config.speak_timeout_ms,
            "player": {
                "playing": self._playing,
                "paused": self._paused,
                "current_sequence": self._cur_seq,
                "current_step": self._cur_step,
                "current_timeline": self._cur_timeline,
                "playhead_ms": self._playhead_ms,
            },
            "last_error": self._last_error,
        }

    async def _publish_state(self) -> None:
        self.publish("state", self._snapshot(), retained=True)

    async def _control_loop(self) -> None:
        await self.run_control_loop()
