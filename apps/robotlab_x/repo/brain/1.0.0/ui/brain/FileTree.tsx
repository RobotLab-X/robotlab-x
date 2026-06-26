// FileTree — expandable workspace+bundled tree on the left of the
// brain view.
//
// Interaction model (IDE-style — VS Code, JetBrains):
//
//   * Click on the CHEVRON of a folder → toggle expand/collapse.
//   * Click on the FOLDER ROW body → select it (highlight). The caller
//     decides what to do with the selection — workflow dirs typically
//     render a summary + Run/Stop toolbar in a sibling pane.
//   * Click on a FILE → open it in the viewer AND select it (file
//     selection IS open).
//   * Hover over any row reveals a ``...`` button at the right —
//     opens a context menu of actions appropriate to the node.
//   * Right-click on any row opens the same menu at the cursor.
//
// Why separate chevron from row click on folders: clicking a workflow
// folder shouldn't trigger an "expand its files" side-effect when the
// user just wants to focus the workflow. The two affordances are
// distinct in modern IDEs and we mirror that.
//
// Files are tagged with their source: workspace files render normally,
// bundled files render dimmed with a small badge. Shadowed bundled
// folders (a workspace folder of the same name exists) carry a
// ``shadowed`` chip so the operator sees they're overridden but can
// still inspect the original via right-click → Open.
import { useState, type MouseEvent } from 'react'
import { ChevronRight, ChevronDown, Folder, FolderOpen, FileText, MoreVertical } from 'lucide-react'

import type { FileEntry, FileSource } from './brainApi'


/** Context menu trigger — either a right-click on a row OR a click
 *  on the hover-revealed "..." button. The caller (Brain.tsx)
 *  decides which menu items make sense for this entry + opens the
 *  ContextMenu component at the supplied (x, y). */
export interface FileTreeContextEvent {
  entry: FileEntry
  position: { x: number; y: number }
}


/** Stable key for selection comparison — same format used for React
 *  keys throughout the tree. Source matters because a workspace and a
 *  bundled file can share a path. */
export function entryKey(path: string, source: FileSource): string {
  return `${source}:${path}`
}


interface FileTreeProps {
  entries: FileEntry[]
  /** Currently-open file's virtual path, for highlighting. */
  openPath?: string | null
  /** Currently-selected entry key (use ``entryKey(path, source)``).
   *  Folders highlight as selected when this matches their key; files
   *  use ``openPath`` for highlighting since selecting a file IS
   *  opening it. */
  selectedKey?: string | null
  /** Single-click on a file → open it. */
  onOpen: (path: string, source: FileSource) => void
  /** Click on a folder row body (NOT the chevron). The caller decides
   *  whether the folder is a workflow root and routes the right pane
   *  accordingly. Files also fire this — selecting a file is part of
   *  opening it. */
  onSelect: (entry: FileEntry) => void
  /** Right-click on a row OR click on the row's "..." button. */
  onContextMenu: (event: FileTreeContextEvent) => void
}


export function FileTree({ entries, openPath, selectedKey, onOpen, onSelect, onContextMenu }: FileTreeProps) {
  return (
    <ul className="text-[12px] font-mono leading-tight">
      {entries.map((e) => (
        <TreeNode
          key={entryKey(e.path, e.source)}
          entry={e}
          depth={0}
          openPath={openPath}
          selectedKey={selectedKey}
          onOpen={onOpen}
          onSelect={onSelect}
          onContextMenu={onContextMenu}
        />
      ))}
    </ul>
  )
}


interface TreeNodeProps {
  entry: FileEntry
  depth: number
  openPath?: string | null
  selectedKey?: string | null
  onOpen: (path: string, source: FileSource) => void
  onSelect: (entry: FileEntry) => void
  onContextMenu: (event: FileTreeContextEvent) => void
}


function TreeNode({ entry, depth, openPath, selectedKey, onOpen, onSelect, onContextMenu }: TreeNodeProps) {
  // Expand top-level dirs by default so the operator doesn't see an
  // empty tree on first open. Deeper levels stay collapsed.
  const [expanded, setExpanded] = useState(depth === 0)
  const [hover, setHover] = useState(false)

  const isOpen = openPath === entry.path
  const isDir = entry.type === 'dir'
  const isBundled = entry.source === 'bundled'
  const isSelected = selectedKey === entryKey(entry.path, entry.source)

  // Row body click. Folders: select (don't toggle — that's the chevron
  // job). Files: open + select (selection follows the viewer).
  const handleRowClick = () => {
    if (isDir) {
      onSelect(entry)
    } else {
      onOpen(entry.path, entry.source)
      onSelect(entry)
    }
  }

  // Chevron click toggles expand/collapse. Stop propagation so the row
  // body's onClick doesn't fire and re-select the same folder.
  const handleChevronClick = (e: MouseEvent) => {
    e.stopPropagation()
    setExpanded((v) => !v)
  }

  const openContextMenu = (clientX: number, clientY: number) => {
    onContextMenu({ entry, position: { x: clientX, y: clientY } })
  }

  const handleRightClick = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    openContextMenu(e.clientX, e.clientY)
  }

  const handleMenuButton = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Anchor the menu to the right of the kebab at the same vertical
    // level (eye stays on the row). 4px of breathing room between the
    // button and the menu. Edge-clamping inside ContextMenu repositions
    // when there's not enough space on the right.
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    openContextMenu(rect.right + 4, rect.top)
  }

  // Tone scaling:
  //  - workspace files: full text-slate-200
  //  - example (bundled) files: text-slate-400 (less prominent — shipped
  //    templates, not your edits)
  //  - currently open file: emerald accent (file selection IS open)
  //  - selected folder: sky accent (selected, not "opened")
  const toneClass = isOpen
    ? 'bg-emerald-950/40 text-emerald-300'
    : isSelected && isDir
      ? 'bg-sky-950/40 text-sky-200'
      : isBundled
        ? 'text-slate-400'
        : 'text-slate-200'

  return (
    <li>
      <div
        className={`group flex cursor-pointer select-none items-center gap-1 rounded px-1 py-0.5 hover:bg-slate-900/60 ${toneClass}`}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={handleRowClick}
        onContextMenu={handleRightClick}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        title={entry.path + (isBundled ? ' (bundled)' : '')}
      >
        {isDir ? (
          <>
            {/* Chevron is its own click target — toggles expand
                without selecting. */}
            <button
              type="button"
              onClick={handleChevronClick}
              className="shrink-0 rounded p-0 hover:bg-slate-800"
              aria-label={expanded ? 'Collapse' : 'Expand'}
            >
              {expanded ? <ChevronDown size={12} className="text-slate-500" />
                        : <ChevronRight size={12} className="text-slate-500" />}
            </button>
            {expanded ? <FolderOpen size={13} className="shrink-0 text-slate-500" />
                      : <Folder size={13} className="shrink-0 text-slate-500" />}
          </>
        ) : (
          <>
            <span className="w-3 shrink-0" />
            <FileText size={12} className="shrink-0 text-slate-600" />
          </>
        )}
        <span className="flex-1 truncate">{entry.name}</span>
        {isBundled && (
          <span className="shrink-0 rounded bg-slate-800 px-1 text-[9px] uppercase tracking-wider text-slate-500"
            title="A shipped, read-only example — duplicate it to edit/run">
            example
          </span>
        )}
        {/* Hover-revealed "..." button. ``group-hover`` keeps the
            button hidden until the row is hovered (the tree stays
            clean visually); ``group-focus-within`` would also be a
            valid axis if we add keyboard focus support later. */}
        <button
          type="button"
          onClick={handleMenuButton}
          onContextMenu={handleRightClick}
          className={`shrink-0 rounded p-0.5 ${
            hover ? 'visible text-slate-400 hover:bg-slate-700 hover:text-slate-200' : 'invisible'
          }`}
          aria-label="Actions"
        >
          <MoreVertical size={12} />
        </button>
      </div>
      {isDir && expanded && entry.children && entry.children.length > 0 && (
        <ul>
          {entry.children.map((child) => (
            <TreeNode
              key={entryKey(child.path, child.source)}
              entry={child}
              depth={depth + 1}
              openPath={openPath}
              selectedKey={selectedKey}
              onOpen={onOpen}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
            />
          ))}
        </ul>
      )}
    </li>
  )
}
