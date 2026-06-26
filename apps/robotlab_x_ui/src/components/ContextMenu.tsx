// ContextMenu — small floating menu for right-click / hover-"..." flows.
//
// Web file-explorer pattern (VS Code, GitHub Codespaces, Notion):
//   * single-click opens / selects (handled by the caller)
//   * hover reveals a "..." trigger button → opens this menu
//   * right-click on the row opens the same menu at cursor position
//
// Positioning: the menu top-left lives at the supplied (x, y) — clamped
// to the viewport so triggers near the right/bottom edges don't get
// clipped. Closes on outside click, Escape, or any menu item click.
import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'


export interface ContextMenuItem {
  label: string
  /** Optional left-aligned icon (lucide or any small ReactNode). */
  icon?: ReactNode
  /** Fired when the item is activated. The menu closes itself
   *  immediately after; the handler runs in the same tick. */
  onClick: () => void
  /** Red accent for destructive actions (delete / drop / etc.). */
  destructive?: boolean
  disabled?: boolean
  /** Optional small explainer shown beneath the label. */
  hint?: string
}


interface ContextMenuProps {
  items: ContextMenuItem[]
  /** Anchor position — top-left of the menu. Use either the mouse
   *  event's ``clientX/clientY`` (right-click) or the trigger
   *  button's ``getBoundingClientRect()`` (hover-"...") values. */
  position: { x: number; y: number }
  onClose: () => void
}


// Approximate menu dimensions used for edge-clamping. The menu's
// actual size depends on content, but a conservative estimate keeps
// menus from spilling off-screen.
const MENU_WIDTH_PX = 220
const MENU_LINE_HEIGHT_PX = 28
const MENU_VPADDING_PX = 8


export function ContextMenu({ items, position, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null)

  // Close on outside click. Use mousedown rather than click so the
  // menu dismisses before any underlying interactive element fires.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [onClose])

  // Close on Escape — keyboard parity with the other dialogs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Edge-clamp the anchor so the menu stays on-screen. The supplied
  // (x, y) is treated as the desired top-left; we shift inward when
  // it'd overflow the viewport.
  const menuHeight = items.length * MENU_LINE_HEIGHT_PX + MENU_VPADDING_PX * 2
  const maxX = window.innerWidth - MENU_WIDTH_PX - 8
  const maxY = window.innerHeight - menuHeight - 8
  const left = Math.max(8, Math.min(position.x, maxX))
  const top = Math.max(8, Math.min(position.y, maxY))

  const handleClick = useCallback((item: ContextMenuItem) => {
    if (item.disabled) return
    item.onClick()
    onClose()
  }, [onClose])

  // Portal to document.body. The brain panel renders inside a React
  // Flow node, whose ancestor uses CSS ``transform`` for pan/zoom.
  // A ``position: fixed`` element inside a transformed parent is
  // positioned relative to that parent, NOT the viewport — so the
  // menu drifts based on the canvas zoom/pan. Portaling to body
  // breaks out of the transform chain entirely.
  const menu = (
    <div
      ref={ref}
      style={{ left, top, width: MENU_WIDTH_PX }}
      className="fixed z-50 overflow-hidden rounded-md border border-slate-700 bg-slate-900 py-1 text-xs text-slate-200 shadow-lg shadow-black/40"
      role="menu"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) => (
        <button
          key={i}
          type="button"
          role="menuitem"
          onClick={() => handleClick(item)}
          disabled={item.disabled}
          className={`flex w-full items-center gap-2 px-2 py-1 text-left text-[12px] disabled:opacity-40 ${
            item.destructive
              ? 'text-red-300 hover:bg-red-950/40'
              : 'hover:bg-slate-800'
          }`}
        >
          {item.icon && <span className="shrink-0 text-slate-500">{item.icon}</span>}
          <span className="flex min-w-0 flex-col">
            <span className="truncate">{item.label}</span>
            {item.hint && (
              <span className="truncate text-[10px] text-slate-500">{item.hint}</span>
            )}
          </span>
        </button>
      ))}
    </div>
  )

  return createPortal(menu, document.body)
}
