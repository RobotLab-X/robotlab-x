// Shape of the workspace.dashboard JSON blob stored on the backend.
// One source of truth for both Dashboard.tsx and the widget components.

export type WidgetType = 'log' | 'topic_stream' | 'metric' | 'status'

export interface BaseWidgetConfig {
  id: string
  type: WidgetType
  title: string
  // Bus topic the widget subscribes to. Required for every widget type
  // shipping today.
  topic: string
}

export interface LogWidgetConfig extends BaseWidgetConfig {
  type: 'log'
  // Path inside the payload to extract for the log line; defaults to the
  // whole payload stringified.
  field?: string
}

export interface TopicStreamWidgetConfig extends BaseWidgetConfig {
  type: 'topic_stream'
}

export interface MetricWidgetConfig extends BaseWidgetConfig {
  type: 'metric'
  // Dotted path into the payload object — `seq` or `position.x`.
  field: string
  unit?: string
  // Number of samples to keep for the sparkline.
  history?: number
}

export interface StatusWidgetConfig extends BaseWidgetConfig {
  type: 'status'
}

export type WidgetConfig =
  | LogWidgetConfig
  | TopicStreamWidgetConfig
  | MetricWidgetConfig
  | StatusWidgetConfig

// One react-grid-layout entry. The library has its own type but we keep
// our own narrowed copy so the persistence shape is explicit + free of
// any extra fields the library adds.
export interface WidgetLayoutEntry {
  i: string // widget id
  x: number
  y: number
  w: number
  h: number
  minW?: number
  minH?: number
}

export interface DashboardState {
  widgets: WidgetConfig[]
  layout: WidgetLayoutEntry[]
}

export const EMPTY_DASHBOARD: DashboardState = { widgets: [], layout: [] }
