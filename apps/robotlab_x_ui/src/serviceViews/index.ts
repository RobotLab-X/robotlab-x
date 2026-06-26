// Registry of service-type-specific UI components still compiled into the
// host SPA. Resolution is static-first: view_full uses this map when a type
// has an entry, else DynamicServiceView loads the type's modular UI bundle
// (Option B — docs/TODO_SERVICE_UI_BUNDLES.md). To add a built-in view:
//   1. Create the component in this directory.
//   2. Add an import + entry below.
//
// All other views migrated to modular bundles (repo/<svc>/1.0.0/ui/View.tsx)
// and their serviceViews/*.tsx were deleted. Only `python` remains static:
// it uses react-router-dom (host router context) — the legitimate
// "stays base-bundled" escape-hatch case.
import type { ComponentType } from 'react'
import type { ServiceProxy } from '../models/ServiceProxy'
import PythonFullView from './Python'

export type ServiceFullView = ComponentType<{ proxy: ServiceProxy }>

export const SERVICE_FULL_VIEWS: Record<string, ServiceFullView> = {
  'python@1.0.0': PythonFullView,
}

export function getFullView(serviceMetaId: string | null | undefined): ServiceFullView | null {
  if (!serviceMetaId) return null
  return SERVICE_FULL_VIEWS[serviceMetaId] ?? null
}
