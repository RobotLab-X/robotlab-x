// Markdown renderer for the brain file viewer (stone A → B of
// docs/TODO_BRAIN_VIEWER.md).
//
// react-markdown + remark-gfm: GitHub-flavored tables, task lists,
// strikethrough, autolinks. No dangerouslySetInnerHTML — react-markdown
// parses to React elements.
//
// The dispatcher (FileViewer.tsx) decides whether a file goes here or
// to CodeEditor. This component only knows how to render markdown.
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'


interface MarkdownViewProps {
  /** Markdown source — caller fetched via brainApi. */
  content: string
}


// Explicit per-element styling. The project doesn't ship
// @tailwindcss/typography, so element styles come from this map.
// Sized to match the rest of the brain panel (small, compact,
// terminal-y).
const MD_COMPONENTS: Components = {
  h1: ({ children }) => <h1 className="mb-2 mt-3 text-base font-semibold text-slate-100">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 mt-3 text-[13px] font-semibold uppercase tracking-wider text-slate-200">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 mt-2 text-[12px] font-semibold text-slate-200">{children}</h3>,
  h4: ({ children }) => <h4 className="mb-1 mt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-300">{children}</h4>,
  p: ({ children }) => <p className="mb-2 text-[12px] leading-relaxed text-slate-300">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 ml-4 list-disc text-[12px] text-slate-300">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal text-[12px] text-slate-300">{children}</ol>,
  li: ({ children }) => <li className="my-0.5">{children}</li>,
  a: ({ children, href }) => (
    <a href={href ?? undefined} target="_blank" rel="noreferrer" className="text-sky-400 hover:underline">
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className="font-semibold text-slate-100">{children}</strong>,
  em: ({ children }) => <em className="italic text-slate-200">{children}</em>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-slate-700 pl-3 text-[12px] italic text-slate-400">
      {children}
    </blockquote>
  ),
  // Inline vs fenced code — react-markdown calls the same ``code``
  // element for both, differentiated by the className.
  code: ({ className, children, ...props }) => {
    const isFenced = /language-\w+/.test(className ?? '')
    if (!isFenced) {
      return (
        <code className="rounded bg-slate-900 px-1 py-0.5 font-mono text-[11px] text-emerald-300" {...props}>
          {children}
        </code>
      )
    }
    return (
      <code className={`block whitespace-pre overflow-x-auto font-mono text-[11px] text-slate-200 ${className ?? ''}`} {...props}>
        {children}
      </code>
    )
  },
  pre: ({ children }) => (
    <pre className="mb-2 overflow-x-auto rounded border border-slate-800 bg-slate-950 p-2">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="min-w-full border-collapse text-[11px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="border-b border-slate-700 text-slate-300">{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr className="border-b border-slate-800/60">{children}</tr>,
  th: ({ children }) => <th className="px-2 py-1 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="px-2 py-1 align-top text-slate-300">{children}</td>,
  hr: () => <hr className="my-3 border-slate-800" />,
}


export function MarkdownView({ content }: MarkdownViewProps) {
  return (
    <div className="px-1">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
