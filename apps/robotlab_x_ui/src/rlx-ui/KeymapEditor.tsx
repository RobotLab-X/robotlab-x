// Shared keymap editor for the `keyboard` capability (used by both the
// keyboard_browser and keyboard_local service cards). Edits the list of
// key → bus-action bindings: each binding fires `on_down` to `topic` on a
// matching key press and `on_up` on release (teleop/hotkey).
//
// Lives in the @rlx/ui SDK so both keyboard bundles render the IDENTICAL
// editor — the user controls bindings the same way wherever the keyboard
// is captured. The card owns the bus calls (onBind/onUnbind/onClear); this
// is the dumb editor.
import { useCallback, useEffect, useRef, useState } from 'react'

export interface KeyBinding {
  id?: string
  combo?: string
  topic?: string
  on_down?: unknown
  on_up?: unknown
}

export interface KeymapEditorProps {
  bindings: KeyBinding[]
  onBind: (b: { combo: string; topic: string; id?: string; on_down?: unknown; on_up?: unknown }) => void
  onUnbind: (id: string) => void
  onClear: () => void
}

// Build a canonical combo string from a DOM keydown — modifiers (in a fixed
// order) + the physical code, e.g. "ctrl+shift+KeyS". Returns null for a
// pure-modifier press (keep listening until a real key arrives).
function comboFromEvent(e: KeyboardEvent): string | null {
  const code = e.code || ''
  if (/^(Control|Shift|Alt|Meta)/.test(code)) return null
  const parts: string[] = []
  if (e.ctrlKey) parts.push('ctrl')
  if (e.altKey) parts.push('alt')
  if (e.shiftKey) parts.push('shift')
  if (e.metaKey) parts.push('meta')
  parts.push(code)
  return parts.join('+')
}

// Parse a JSON payload field. '' → undefined (omit); invalid → throws.
function parsePayload(text: string): unknown {
  const t = text.trim()
  if (!t) return undefined
  return JSON.parse(t)
}

function stringifyPayload(v: unknown): string {
  return v === undefined || v === null ? '' : JSON.stringify(v)
}

const field = 'rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-200 font-mono'
const btn = 'rounded px-2 py-1 text-[11px] disabled:opacity-40'

export function KeymapEditor({ bindings, onBind, onUnbind, onClear }: KeymapEditorProps) {
  const [combo, setCombo] = useState('')
  const [topic, setTopic] = useState('')
  const [downText, setDownText] = useState('')
  const [upText, setUpText] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [capturing, setCapturing] = useState(false)

  // One-shot DOM capture of the next non-modifier key → fills `combo`.
  const capturingRef = useRef(false)
  capturingRef.current = capturing
  useEffect(() => {
    if (!capturing) return
    const onKey = (e: KeyboardEvent) => {
      const c = comboFromEvent(e)
      if (!c) return // pure modifier — keep waiting
      e.preventDefault()
      e.stopImmediatePropagation()
      setCombo(c)
      setCapturing(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturing])

  const downErr = (() => { try { parsePayload(downText); return false } catch { return true } })()
  const upErr = (() => { try { parsePayload(upText); return false } catch { return true } })()
  const canSubmit = combo.trim() !== '' && topic.trim() !== '' && !downErr && !upErr

  const reset = useCallback(() => {
    setCombo(''); setTopic(''); setDownText(''); setUpText(''); setEditingId(null); setCapturing(false)
  }, [])

  const submit = useCallback(() => {
    if (!canSubmit) return
    onBind({
      combo: combo.trim(),
      topic: topic.trim(),
      id: editingId ?? undefined,
      on_down: parsePayload(downText),
      on_up: parsePayload(upText),
    })
    reset()
  }, [canSubmit, combo, topic, editingId, downText, upText, onBind, reset])

  const editRow = useCallback((b: KeyBinding) => {
    setEditingId(b.id ?? b.combo ?? null)
    setCombo(b.combo ?? '')
    setTopic(b.topic ?? '')
    setDownText(stringifyPayload(b.on_down))
    setUpText(stringifyPayload(b.on_up))
    setCapturing(false)
  }, [])

  return (
    <div className="rounded border border-slate-800 p-2 text-[11px]">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-medium text-slate-400">keymap ({bindings.length})</span>
        {bindings.length > 0 && (
          <button type="button" className="text-slate-500 hover:text-rose-300" onClick={onClear}>clear all</button>
        )}
      </div>

      {/* existing bindings */}
      {bindings.length > 0 && (
        <ul className="mb-2 space-y-0.5">
          {bindings.map((b, i) => {
            const id = b.id ?? b.combo ?? String(i)
            return (
              <li key={id} className="flex items-center gap-2 font-mono">
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-200">{b.combo}</span>
                <span className="text-slate-500">→</span>
                <span className="min-w-0 flex-1 truncate text-slate-400">{b.topic}</span>
                <button type="button" className="text-slate-500 hover:text-sky-300" onClick={() => editRow(b)}>edit</button>
                <button type="button" className="text-slate-500 hover:text-rose-300" onClick={() => onUnbind(id)}>✕</button>
              </li>
            )
          })}
        </ul>
      )}

      {/* add / edit form */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <input className={`${field} w-36`} placeholder="combo e.g. KeyW" value={combo}
            onChange={(e) => setCombo(e.target.value)} />
          <button type="button" className={`${btn} ${capturing ? 'bg-amber-700 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'}`}
            onClick={() => setCapturing((v) => !v)}>
            {capturing ? 'press a key…' : 'capture'}
          </button>
        </div>
        <input className={field} placeholder="topic e.g. /motor_control/mc-1/control" value={topic}
          onChange={(e) => setTopic(e.target.value)} />
        <input className={`${field} ${downErr ? 'border-rose-600' : ''}`} placeholder='on_down JSON e.g. {"action":"set","value":1}'
          value={downText} onChange={(e) => setDownText(e.target.value)} />
        <input className={`${field} ${upErr ? 'border-rose-600' : ''}`} placeholder='on_up JSON e.g. {"action":"set","value":0}'
          value={upText} onChange={(e) => setUpText(e.target.value)} />
        <div className="flex items-center gap-1.5">
          <button type="button" className={`${btn} bg-sky-700 text-white hover:bg-sky-600`} disabled={!canSubmit} onClick={submit}>
            {editingId ? 'Update' : 'Add'}
          </button>
          {(editingId || combo || topic) && (
            <button type="button" className={`${btn} bg-slate-800 text-slate-300 hover:bg-slate-700`} onClick={reset}>cancel</button>
          )}
          {(downErr || upErr) && <span className="text-rose-400">invalid JSON</span>}
        </div>
      </div>
    </div>
  )
}
