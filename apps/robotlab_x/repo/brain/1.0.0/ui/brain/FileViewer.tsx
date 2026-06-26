// FileViewer — routes a brain workspace file to the right renderer.
//
//   view mode + markdown      → MarkdownView (rendered)
//   view mode + everything    → CodeEditor (read-only, syntax-aware)
//   edit mode (any file)      → CodeEditor (editable, with markdown
//                                 source view for .md)
//
// Stone B added the read-only viewer dispatch; stone C adds editable
// pass-through. The caller (Brain.tsx) owns the buffer state — this
// component is purely presentational.
import { CodeEditor } from './CodeEditor'
import { MarkdownView } from './MarkdownView'


interface FileViewerProps {
  content: string
  mime: string
  /** Original filename — drives the language fallback when mime is
   *  too generic (e.g. ``.py`` files often come back as text/plain). */
  filename?: string
  /** Stone C: when true, render the editable CodeEditor regardless of
   *  mime. Markdown switches from rendered to source mode. */
  editing?: boolean
  /** Buffer change handler (only relevant when editing). */
  onChange?: (value: string) => void
  /** Ctrl/Cmd-S handler (only relevant when editing). */
  onSave?: () => void
}


export function FileViewer({
  content, mime, filename, editing = false, onChange, onSave,
}: FileViewerProps) {
  // Edit mode: always CodeEditor — even for markdown, the operator
  // sees raw source while editing. The "Preview" toggle (in
  // Brain.tsx) flips them back to view mode if they want to see
  // rendered output.
  if (editing) {
    return (
      <div className="h-full overflow-hidden">
        <CodeEditor
          content={content}
          mime={mime}
          filename={filename}
          readOnly={false}
          onChange={onChange}
          onSave={onSave}
        />
      </div>
    )
  }

  // View mode dispatch — same as stone B.
  if (mime === 'text/markdown') {
    return (
      <div className="h-full overflow-auto">
        <MarkdownView content={content} />
      </div>
    )
  }
  return (
    <div className="h-full overflow-hidden">
      <CodeEditor content={content} mime={mime} filename={filename} readOnly />
    </div>
  )
}
