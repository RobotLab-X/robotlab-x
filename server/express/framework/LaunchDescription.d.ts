export as namespace LaunchDescription

export interface LaunchAction {
  package: string
  name: string
  config?: { [key: string]: any }
  namespace?: string
  parameters?: { [key: string]: any }
  output?: string
}

export default class LaunchDescription {
  description: string
  version: string

  constructor(actions?: LaunchAction[])

  addNode(action: LaunchAction): void
  getLaunchActions(): LaunchAction[]
  sendToServer(url: string): void
}
