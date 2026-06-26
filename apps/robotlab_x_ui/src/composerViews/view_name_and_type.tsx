// view_name_and_type — mid-size card showing the proxy's name plus
// the service-type id and a status pill. The whole card is the drag
// handle; double-click promotes to view_full.
//
// Extracted from Composer.tsx — formerly the inline ``ProxyNodeFull``
// function. ("Full" was a confusing name for what is really the
// "name+type" shape — the truly-full UI lives in view_full.tsx.)
import { ServiceIcon, STATUS_TONE, metaNameFromId, metaVersionFromId } from './_shared'
import { NodeViewMenu } from './_NodeViewMenu'
import type { ComposerViewDefinition, ComposerViewProps } from './types'


function ProxyNodeNameAndType({ proxy, selected, onViewChange }: ComposerViewProps) {
  const tone = STATUS_TONE[proxy.status ?? 'stopped'] ?? STATUS_TONE.stopped
  // The whole card is the drag handle. Double-click promotes to the
  // full view.
  const onTitleDoubleClick = () => {
    const proxyId = proxy.id ?? proxy.name ?? ''
    onViewChange?.(proxyId, 'view_full')
  }
  return (
    <div
      onDoubleClick={onTitleDoubleClick}
      className={`rlx-drag-handle flex min-w-[180px] cursor-grab items-start gap-2 rounded border bg-slate-900/95 p-3 shadow-lg ${
        selected ? 'border-sky-400' : 'border-slate-700'
      }`}
    >
      <ServiceIcon
        name={metaNameFromId(proxy.service_meta_id)}
        version={metaVersionFromId(proxy.service_meta_id)}
        className="mt-0.5 h-5 w-5 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-1">
          <div className="truncate text-xs font-mono text-slate-400">{proxy.service_meta_id}</div>
          <NodeViewMenu
            proxy={proxy}
            current="view_name_and_type"
            onChange={onViewChange}
          />
        </div>
        <div className="mt-0.5 truncate font-semibold text-slate-100">{proxy.name ?? proxy.id}</div>
        <span className={`mt-2 inline-block rounded px-2 py-0.5 text-xs font-medium ${tone}`}>
          {proxy.status ?? 'unknown'}
        </span>
      </div>
    </div>
  )
}


const definition: ComposerViewDefinition = {
  id: 'view_name_and_type',
  label: 'Name & type',
  order: 1,
  Component: ProxyNodeNameAndType,
  preservesSize: false,
}
export default definition
