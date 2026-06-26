// view_basic — compact servo-control panel. Smaller than Full but
// not Min: three sliders (position, speed, limits) plus a Stop and
// a Detach/Attach toggle. Designed for "I just want to nudge this
// servo" workflows without the form-driven attachment + sweep UI
// of the full view.
//
// Servo-only. ``shouldOffer`` keys on the service-type name so the
// kebab only surfaces "Basic" on servo nodes; every other service
// type sees Min / Name & type / Full and not this one.
//
// Position writes LIVE on slider drag (matches Full view's feel).
// Speed + limits commit on slider release. The Detach button is a
// toggle: when attached it sends ``detach``; when detached (but a
// previous controller config is remembered on the backend) it sends
// ``attach`` with no args, which resumes the same binding. The
// servo service preserves ``controller_type`` / ``controller_id`` /
// ``pin`` across a detach for exactly this round-trip.
import { useCallback, useEffect, useState } from 'react'

import type { InboundFrame } from '../runtime/wsClient'
import { useWsClient } from '../contexts/ActiveRuntimeContext'
import { ServiceIcon, STATUS_DOT, metaNameFromId, metaVersionFromId } from './_shared'
import { NodeViewMenu } from './_NodeViewMenu'
import type { ComposerViewDefinition, ComposerViewProps } from './types'


interface ServoState {
  angle?: number
  current_angle?: number
  moving?: boolean
  speed_deg_per_s?: number
  speed_control_enabled?: boolean
  min_angle?: number
  max_angle?: number
  attached?: boolean
  pin?: number | null
  controller_id?: string | null
  controller_type?: string | null
}


function ProxyNodeBasic({ proxy, selected, onViewChange }: ComposerViewProps) {
  const wsClient = useWsClient()
  const proxyId = proxy.id ?? proxy.name ?? ''
  const stateTopic = `/servo/${proxyId}/state`
  const controlTopic = `/servo/${proxyId}/control`
  const status = proxy.status ?? 'stopped'
  const dot = STATUS_DOT[status] ?? STATUS_DOT.stopped

  const [state, setState] = useState<ServoState>({})
  // Drafts decouple slider value from authoritative state so a
  // mid-drag publish from the backend doesn't yank the thumb out of
  // the user's finger. ``draggingX`` gates the mirror useEffect below.
  const [angleDraft, setAngleDraft] = useState(90)
  const [speedDraft, setSpeedDraft] = useState(90)
  const [minDraft, setMinDraft] = useState(0)
  const [maxDraft, setMaxDraft] = useState(180)
  const [draggingAngle, setDraggingAngle] = useState(false)
  const [draggingSpeed, setDraggingSpeed] = useState(false)
  const [draggingLimits, setDraggingLimits] = useState(false)

  useEffect(() => {
    if (!proxyId) return
    const off = wsClient.subscribe(stateTopic, (f: InboundFrame) => {
      if (f.method !== 'message') return
      const p = (f.payload ?? {}) as ServoState
      // Merge — /state publishes partial-ish updates while a motion
      // is in flight (only ``current_angle`` + ``moving`` change
      // frame to frame). Spreading preserves the last-seen values
      // for the fields that didn't change.
      setState((prev) => ({ ...prev, ...p }))
    })
    return off
  }, [proxyId, stateTopic, wsClient])

  // Mirror authoritative state into the local drafts when the user
  // isn't actively dragging that slider. Without this gate the
  // backend's republish on every write would visibly jitter the
  // thumb as the operator drags.
  useEffect(() => {
    if (draggingAngle) return
    if (typeof state.angle === 'number') setAngleDraft(state.angle)
  }, [state.angle, draggingAngle])
  useEffect(() => {
    if (draggingSpeed) return
    if (typeof state.speed_deg_per_s === 'number') setSpeedDraft(state.speed_deg_per_s)
  }, [state.speed_deg_per_s, draggingSpeed])
  useEffect(() => {
    if (draggingLimits) return
    if (typeof state.min_angle === 'number') setMinDraft(state.min_angle)
    if (typeof state.max_angle === 'number') setMaxDraft(state.max_angle)
  }, [state.min_angle, state.max_angle, draggingLimits])

  const sendAction = useCallback(
    (payload: Record<string, unknown>) => { wsClient.publish(controlTopic, payload) },
    [wsClient, controlTopic],
  )
  const onWrite = (v: number) => sendAction({ action: 'write', angle: v })
  const onStop = () => sendAction({ action: 'stop' })
  const onSetSpeed = (v: number) => sendAction({ action: 'set_speed', speed_deg_per_s: v })
  const onSetLimits = (lo: number, hi: number) =>
    sendAction({ action: 'set_limits', min_angle: lo, max_angle: hi })
  const onToggleInterp = (enabled: boolean) =>
    sendAction({ action: 'set_speed_control_enabled', enabled })

  const attached = !!state.attached
  // A re-attach (no-arg ``attach``) only makes sense when the backend
  // still has the previous controller config persisted. We surface
  // that as a single Attach/Detach toggle; when neither attached nor
  // resumable, point the operator at Full view to set up a binding.
  const canResume = !attached && !!state.controller_id && state.pin != null
  const toggleAttach = () => {
    if (attached) {
      sendAction({ action: 'detach' })
    } else if (canResume) {
      sendAction({ action: 'attach' })
    }
  }

  const minA = typeof state.min_angle === 'number' ? state.min_angle : 0
  const maxA = typeof state.max_angle === 'number' ? state.max_angle : 180
  // Limits dual-slider's selected segment is computed against the
  // full 0–180 servo envelope, not the soft min/max — those are
  // what we're dragging.
  const minPct = (minDraft / 180) * 100
  const maxPct = (maxDraft / 180) * 100
  const speedEnabled = state.speed_control_enabled !== false

  return (
    <div
      className={`flex w-[380px] flex-col rounded border bg-slate-900/95 shadow-lg ${
        selected ? 'border-sky-400' : 'border-slate-700'
      }`}
    >
      {/* Title bar — drag handle + double-click-to-promote-to-Full.
          Mirrors the convention from view_min / view_name_and_type
          (double-click the title to expand) so the operator's muscle
          memory carries across shapes. The body below catches its
          own onPointerDown to keep the slider drags from being
          treated as title clicks. Includes the interpolated checkbox
          so the operator can flip motion mode without leaving Basic.
          Pin + controller appear after the proxy name in greyed
          mono so the binding is visible at a glance. */}
      <div
        onDoubleClick={() => onViewChange?.(proxyId, 'view_full')}
        className="rlx-drag-handle flex shrink-0 cursor-grab items-center gap-2 border-b border-slate-800 px-3 py-1.5"
      >
        <ServiceIcon
          name={metaNameFromId(proxy.service_meta_id)}
          version={metaVersionFromId(proxy.service_meta_id)}
          className="h-4 w-4 shrink-0"
        />
        <span className="truncate font-mono text-xs text-slate-200">
          {proxy.name ?? proxy.id}
        </span>
        {attached && state.pin != null && (
          <span className="font-mono text-[10px] text-slate-500" title={state.controller_id ?? undefined}>
            pin {state.pin}
          </span>
        )}
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${dot}`}
          title={status}
          aria-label={`status: ${status}`}
        />
        <label
          className="nodrag nopan ml-auto flex cursor-pointer items-center gap-1"
          title="When off, writes snap to target. When on, motion interpolates at the speed slider's rate."
          onPointerDown={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={speedEnabled}
            onChange={(e) => { e.stopPropagation(); onToggleInterp(e.target.checked) }}
            onClick={(e) => e.stopPropagation()}
            className="nodrag nopan h-3 w-3 accent-emerald-500"
          />
          <span className={`text-[9px] uppercase tracking-wider ${speedEnabled ? 'text-emerald-300' : 'text-slate-500'}`}>
            interp
          </span>
        </label>
        <NodeViewMenu proxy={proxy} current="view_basic" onChange={onViewChange} />
      </div>

      <div
        className="flex flex-col gap-1.5 p-2 text-[11px]"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {!attached && !canResume ? (
          <div className="rounded border border-slate-800 bg-slate-950/70 p-2 text-slate-500">
            No controller bound. Switch to Full view to pick one.
          </div>
        ) : !attached ? (
          // Resumable detached state — sliders are inert (no live
          // controller to write to), but the operator can flip the
          // toggle below to re-attach with the same binding.
          <div className="rounded border border-slate-800 bg-slate-950/70 p-2 text-[10px] text-slate-500">
            Detached. Last bound to{' '}
            <span className="font-mono text-slate-300">
              {state.controller_id}
            </span>{' '}
            pin <span className="font-mono text-slate-300">{state.pin}</span>.
          </div>
        ) : (
          <>
            {/* Position — live-writes on drag (no Move button). */}
            <div className="flex items-center gap-2">
              <span className="w-14 shrink-0 text-[10px] uppercase tracking-wider text-slate-500">
                position
              </span>
              <input
                type="range"
                min={minA}
                max={maxA}
                step={1}
                value={angleDraft}
                className="nodrag nopan flex-1 accent-emerald-500"
                onPointerDown={() => setDraggingAngle(true)}
                onPointerUp={() => setDraggingAngle(false)}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setAngleDraft(v)
                  onWrite(v)
                }}
              />
              <span className="w-20 shrink-0 text-right font-mono text-[10px] text-slate-300">
                {angleDraft}°
                {state.moving && (
                  <span className="ml-1 text-amber-300">→{state.current_angle}°</span>
                )}
              </span>
            </div>

            {/* Speed — commits on release. */}
            <div className="flex items-center gap-2">
              <span className="w-14 shrink-0 text-[10px] uppercase tracking-wider text-slate-500">
                speed
              </span>
              <input
                type="range"
                min={1}
                max={360}
                step={5}
                value={speedDraft}
                className="nodrag nopan flex-1 accent-sky-500"
                onPointerDown={() => setDraggingSpeed(true)}
                onPointerUp={() => {
                  setDraggingSpeed(false)
                  onSetSpeed(speedDraft)
                }}
                onChange={(e) => setSpeedDraft(Number(e.target.value))}
              />
              <span className="w-20 shrink-0 text-right font-mono text-[10px] text-slate-300">
                {speedDraft} °/s
              </span>
            </div>

            {/* Limits — dual-thumb, commits on release. Reuses the
                ``.dual-range`` / ``.dual-thumb`` classes from
                index.css so styling matches the Full view. */}
            <div className="flex items-center gap-2">
              <span className="w-14 shrink-0 text-[10px] uppercase tracking-wider text-slate-500">
                limits
              </span>
              <div className="dual-range nodrag nopan relative h-6 flex-1">
                <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded bg-slate-700" />
                <div
                  className="absolute top-1/2 h-1 -translate-y-1/2 rounded bg-sky-500"
                  style={{ left: `${minPct}%`, right: `${100 - maxPct}%` }}
                />
                <input
                  type="range"
                  className="dual-thumb"
                  min={0}
                  max={180}
                  step={1}
                  value={minDraft}
                  onPointerDown={() => setDraggingLimits(true)}
                  onPointerUp={() => {
                    setDraggingLimits(false)
                    onSetLimits(minDraft, maxDraft)
                  }}
                  onChange={(e) =>
                    setMinDraft(Math.min(Number(e.target.value), maxDraft - 1))
                  }
                  aria-label="min angle"
                />
                <input
                  type="range"
                  className="dual-thumb"
                  min={0}
                  max={180}
                  step={1}
                  value={maxDraft}
                  onPointerDown={() => setDraggingLimits(true)}
                  onPointerUp={() => {
                    setDraggingLimits(false)
                    onSetLimits(minDraft, maxDraft)
                  }}
                  onChange={(e) =>
                    setMaxDraft(Math.max(Number(e.target.value), minDraft + 1))
                  }
                  aria-label="max angle"
                />
              </div>
              <span className="w-20 shrink-0 text-right font-mono text-[10px] text-slate-300">
                {minDraft}°–{maxDraft}°
              </span>
            </div>
          </>
        )}

        {/* Action row. Detach is a toggle — label flips between
            Detach (attached) and Attach (resumable). Disabled when
            there's nothing to bind to. */}
        <div className="mt-1 flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onStop() }}
            onPointerDown={(e) => e.stopPropagation()}
            disabled={!state.moving}
            className="nodrag nopan rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-200 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Stop
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); toggleAttach() }}
            onPointerDown={(e) => e.stopPropagation()}
            disabled={!attached && !canResume}
            title={
              attached
                ? 'Release the pin (config kept so Attach resumes it)'
                : canResume
                  ? `Re-attach to ${state.controller_id} pin ${state.pin}`
                  : 'No controller bound — use Full view to pick one'
            }
            className={
              attached
                ? 'nodrag nopan rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-200 hover:border-rose-500 hover:text-rose-300'
                : 'nodrag nopan rounded border border-emerald-700 bg-emerald-900/40 px-2 py-0.5 text-[10px] text-emerald-200 hover:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-40'
            }
          >
            {attached ? 'Detach' : 'Attach'}
          </button>
        </div>
      </div>
    </div>
  )
}


const definition: ComposerViewDefinition = {
  id: 'view_basic',
  label: 'Basic',
  // Sits between Name & type (1) and Full (2) in the kebab — Basic
  // is "more than just a label, less than the full panel". Numeric
  // gap (1.5) so future shapes can interleave without renumbering.
  order: 1.5,
  Component: ProxyNodeBasic,
  preservesSize: false,
  // Servo-only. ``metaNameFromId`` strips the version so future
  // ``servo@1.1.0`` / ``servo@2.0.0`` still match without an edit.
  shouldOffer: (proxy) => metaNameFromId(proxy.service_meta_id) === 'servo',
}
export default definition
