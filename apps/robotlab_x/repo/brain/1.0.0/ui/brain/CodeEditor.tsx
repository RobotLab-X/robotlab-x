// Code viewer for non-markdown brain workspace files (stone B of
// docs/TODO_BRAIN_VIEWER.md).
//
// Reads-only in stone B; stone C flips the ``readOnly`` prop to false
// when the user clicks Edit. CodeMirror 6 via @uiw/react-codemirror —
// chosen over Monaco for bundle weight (~200KB vs ~3MB) and because
// the brain's workspace doesn't need IntelliSense.
//
// Language detection is mime-first with a filename extension fallback,
// so a brain prompt that lacks a clean mime still highlights right.
// jsonl files render with NO json language extension — applying json
// mode would flag every line break as a syntax error.
import { useEffect, useMemo, useRef, useState } from 'react'

import CodeMirror, { type Extension, type ReactCodeMirrorRef } from '@uiw/react-codemirror'
// Yaml uses the legacy stream parser (StreamLanguage) instead of the
// Lezer-based ``@codemirror/lang-yaml``. The Lezer version registers
// ``foldNodeProp`` on every Item/Pair/BlockLiteral, which combined
// with ``lineWrapping`` confuses CodeMirror v6's content-height
// estimator — ``.cm-scroller`` reports ``scrollHeight ===
// clientHeight`` so the browser renders the scrollbar gutter
// without a bottom arrow or a draggable thumb, and the cursor can
// drive past the viewport with no scroll-into-view. The legacy
// stream parser has no AST + no foldNodeProp, so the estimator
// works correctly. Highlighting is slightly less precise but
// indistinguishable for the simple yaml files we edit here.
import { StreamLanguage } from '@codemirror/language'
import { yaml as legacyYaml } from '@codemirror/legacy-modes/mode/yaml'
import { json } from '@codemirror/lang-json'
import { python } from '@codemirror/lang-python'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorView, keymap } from '@codemirror/view'


interface CodeEditorProps {
  content: string
  mime: string
  filename?: string
  /** False enables editing (stone C). */
  readOnly?: boolean
  /** Wrap long lines instead of horizontal scroll. Default true —
   *  jsonl logs and python scripts have arbitrarily long lines and
   *  horizontal scroll in a sidebar pane is painful. */
  lineWrap?: boolean
  /** Fired on every content change when editable. */
  onChange?: (value: string) => void
  /** Fired when the operator presses Ctrl/Cmd-S inside the editor. */
  onSave?: () => void
}


/** Pick the CodeMirror language extension for this file.
 *
 * Returns ``null`` for plain text + jsonl + log — CodeMirror handles
 * those fine with just line numbers and no tokenizer noise. */
function pickLanguage(mime: string, filename?: string): Extension | null {
  const name = (filename ?? '').toLowerCase()
  if (mime === 'application/x-yaml' || mime === 'text/yaml'
      || name.endsWith('.yaml') || name.endsWith('.yml')) {
    // Legacy stream-parser yaml — see import comment above for why.
    return StreamLanguage.define(legacyYaml)
  }
  // Single JSON only — NOT jsonl. Stone B's jsonl render is plain
  // line-numbered text since each line is independent.
  if (mime === 'application/json' || name.endsWith('.json')) {
    return json()
  }
  if (name.endsWith('.py') || mime === 'text/x-python') {
    return python()
  }
  // Stone C: markdown is editable here in source mode. The view-mode
  // markdown render still uses MarkdownView; CodeEditor is only
  // reached for markdown when the operator clicked Edit.
  if (mime === 'text/markdown' || name.endsWith('.md') || name.endsWith('.markdown')) {
    return markdown()
  }
  return null
}


/** Whether the editor should wrap long lines. Yaml is excluded
 *  because the wrap × incremental-parse interaction in CodeMirror v6
 *  underestimates ``.cm-scroller``'s content height — the symptom is
 *  a scrollbar gutter with a full-length thumb, no bottom arrow, and
 *  the cursor driving past the viewport without scrolling. Yaml
 *  content is mostly short keys + the occasional block literal;
 *  letting the rare long line scroll horizontally is the lesser
 *  evil vs. losing vertical scroll entirely. */
function shouldWrap(mime: string, filename?: string): boolean {
  const name = (filename ?? '').toLowerCase()
  if (mime === 'application/x-yaml' || mime === 'text/yaml'
      || name.endsWith('.yaml') || name.endsWith('.yml')) {
    return false
  }
  return true
}


// Files that auto-scroll-to-bottom when content updates (stone F
// tail mode). These are append-only logs the operator wants to watch
// live as the brain produces them. Edit mode disables tail —
// scrolling under the operator's cursor while they're typing is rude.
function isTailable(mime: string, filename?: string): boolean {
  const name = (filename ?? '').toLowerCase()
  return mime === 'application/x-ndjson'
    || name.endsWith('.jsonl')
    || name.endsWith('.log')
}


export function CodeEditor({
  content, mime, filename, readOnly = true, lineWrap = true,
  onChange, onSave,
}: CodeEditorProps) {
  const editorRef = useRef<ReactCodeMirrorRef>(null)
  // Track whether we should auto-scroll on the next content update.
  // Set to true when the operator hasn't scrolled away from the
  // bottom; reset when they do. Keeps tail mode polite — if the
  // operator scrolls up to read an earlier line, we don't yank them
  // back when the next line arrives.
  const stickToBottomRef = useRef(true)
  // Measured pixel height of the wrapper. Passing this to CodeMirror's
  // ``height`` prop in pixels (e.g. ``"347px"``) sidesteps the
  // percentage-cascade fragility that broke yaml's vertical scroll.
  // ``height="100%"`` worked for other file types but yaml's
  // initial parse + lineWrap × incremental-measure combo settled
  // ``.cm-editor`` to content-height before the parent's flex layout
  // resolved — net effect: scroller reported scrollHeight === clientHeight,
  // scrollbar gutter rendered without a bottom arrow or thumb. With
  // a fixed pixel target written into a ResizeObserver, the editor's
  // bounding box matches the wrapper exactly no matter what the
  // parser does.
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const [pxHeight, setPxHeight] = useState<number | null>(null)
  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height
      if (typeof h === 'number' && h > 0) setPxHeight(Math.floor(h))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Tail mode: after a content update, scroll to the end of the doc
  // — but only when the operator was already at the bottom. CodeMirror's
  // scrollIntoView effect respects the viewport math automatically.
  useEffect(() => {
    if (readOnly !== true) return  // edit mode never auto-scrolls
    if (!isTailable(mime, filename)) return
    if (!stickToBottomRef.current) return
    const view = editorRef.current?.view
    if (!view) return
    const lastLine = view.state.doc.lines
    if (lastLine < 1) return
    const lineEnd = view.state.doc.line(lastLine).to
    view.dispatch({
      effects: EditorView.scrollIntoView(lineEnd, { y: 'end' }),
    })
  }, [content, mime, filename, readOnly])


  const extensions = useMemo<Extension[]>(() => {
    const out: Extension[] = []
    const lang = pickLanguage(mime, filename)
    if (lang) out.push(lang)
    // Yaml suppresses wrap regardless of the prop default — see
    // ``shouldWrap`` for the rationale. Other file types honour the
    // caller's ``lineWrap`` choice (default true).
    if (lineWrap && shouldWrap(mime, filename)) out.push(EditorView.lineWrapping)
    // Force the editor + scroller to fill the wrapper's bounded
    // height. @uiw/react-codemirror's height="100%" prop already
    // emits ``& { height: '100%' }`` + ``& .cm-scroller { height:
    // 100% !important }``, but that's not enough on its own — without
    // ``max-height``, ``.cm-editor`` resolves height: 100% to the
    // parent's content height (which is auto, so it grows), and the
    // scroller never engages. ``maxHeight: 100%`` (via the prop
    // below + this theme) clamps the editor to its parent's bounded
    // height, which makes the scroller the box content has to
    // overflow against. ``overflow-y: scroll`` forces the bar to
    // always render so the operator sees the affordance even when
    // content fits — matches IDE convention vs auto's "only when
    // needed" reveal.
    out.push(EditorView.theme({
      '&': { height: '100%', maxHeight: '100%' },
      '.cm-scroller': { overflowY: 'scroll', overflowX: 'auto' },
    }))
    // Ctrl/Cmd-S inside the editor saves — matches every other code
    // tool the operator knows. preventDefault stops the browser's
    // "save page as" dialog.
    if (onSave) {
      out.push(keymap.of([{
        key: 'Mod-s',
        preventDefault: true,
        run: () => { onSave(); return true },
      }]))
    }
    // Tail-mode scroll tracker — update stickToBottomRef as the user
    // scrolls. Tail-only files measure whether the operator is near
    // the bottom (within 24px) to decide whether to auto-follow.
    if (isTailable(mime, filename)) {
      out.push(EditorView.domEventHandlers({
        scroll(_event, view) {
          const scroller = view.scrollDOM
          const atBottom =
            scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 24
          stickToBottomRef.current = atBottom
        },
      }))
    }
    return out
  }, [mime, filename, lineWrap, onSave])

  return (
    <div ref={wrapperRef} className="h-full overflow-hidden">
      {pxHeight !== null && (
        <CodeMirror
          ref={editorRef}
          value={content}
          theme={oneDark}
          extensions={extensions}
          editable={!readOnly}
          readOnly={readOnly}
          basicSetup={{
            lineNumbers: true,
            foldGutter: false,        // hide fold caret — workspace files are short
            highlightActiveLine: false,
            bracketMatching: true,
            autocompletion: false,    // stone C — keep this off; less noise
            searchKeymap: false,      // avoid Ctrl-F clash with the host app
            history: !readOnly,       // undo only makes sense in edit mode
          }}
          // Pixel height comes from the wrapper's ResizeObserver above.
          // ``${pxHeight}px`` is concrete — CodeMirror's content-height
          // estimator gets a definite target to compare against, so
          // every language extension (including yaml + lineWrapping)
          // settles ``.cm-scroller``'s scrollHeight correctly.
          height={`${pxHeight}px`}
          className="text-[12px]"
          onChange={onChange}
          // Stop pointer events from bubbling to React Flow so dragging
          // inside the editor doesn't pan the canvas.
          onPointerDown={(e) => e.stopPropagation()}
        />
      )}
    </div>
  )
}
