// Number-input wrapper that doesn't eat the dash.
//
// The native ``<input type="number">`` element has a controlled-input
// trap: while the user is mid-typing, the field value can be
// "partial" — ``""``, ``"-"``, ``"."``, ``"-."`` — none of which
// parse as a finite Number. The naive pattern
//   value={n}
//   onChange={(e) => setN(Number(e.target.value))}
// turns those partials into NaN, React then re-renders ``value={NaN}``
// which the browser displays as empty, and the dash the user just
// typed is gone. Users can never get a leading "-" in.
//
// Fix: maintain the raw STRING locally. Commit a parsed number to
// the caller only when the string is a finite number; otherwise hold
// the partial in local state without touching the caller's value. On
// blur, either commit the final parse or snap back to the caller's
// value if the partial is unrecoverable. Re-sync local from prop
// whenever the prop changes externally (e.g. a "use ✕" copy button)
// AND that prop value doesn't already round-trip from our local.
import {
  useEffect, useState,
  type InputHTMLAttributes,
} from 'react'


export interface NumberInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  /** Committed numeric value owned by the caller. */
  value: number
  /** Fires whenever the user types a fully-parseable number. Partial
   *  strings (e.g. "-", ".") do NOT call this — they stay local until
   *  they parse cleanly or blur snaps them back. */
  onChange: (n: number) => void
}


export function NumberInput({ value, onChange, onBlur, ...rest }: NumberInputProps) {
  // Local raw string. Initialised from ``value``; kept in sync via
  // the useEffect below when the caller mutates ``value`` directly
  // (e.g. a "reset" or "use current" button).
  const [local, setLocal] = useState<string>(() => String(value))

  useEffect(() => {
    // Only re-sync when the prop disagrees with what our local would
    // commit. Without this guard, every keystroke would round-trip
    // through the parent's state and clobber a still-partial local
    // (e.g. "-" → 0 → "0", losing the dash).
    const parsed = Number(local)
    if (Number.isFinite(parsed) && parsed === value) return
    setLocal(String(value))
    // ``local`` intentionally excluded from deps — we only resync on
    // external value changes, not on our own local edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return (
    <input
      {...rest}
      type="number"
      value={local}
      onChange={(e) => {
        const v = e.target.value
        setLocal(v)
        // Empty / partial-negative / lone-dot states stay local while
        // the user is mid-typing. ``Number('')`` is 0 which would
        // erroneously commit zero on every input clear, so skip that
        // explicitly too.
        if (v === '') return
        const n = Number(v)
        if (Number.isFinite(n)) onChange(n)
      }}
      onBlur={(e) => {
        // Final commit on blur. If the partial is salvageable (e.g.
        // user left just "-" in the field), snap back to the last
        // committed value so we never persist NaN.
        const n = Number(local)
        if (Number.isFinite(n)) {
          onChange(n)
          setLocal(String(n))
        } else {
          setLocal(String(value))
        }
        onBlur?.(e)
      }}
    />
  )
}
