// LaunchDescription.d.ts
export as namespace LaunchDescription

export interface LaunchAction {
  package: string
  executable: string
  name: string
  namespace?: string
  parameters?: { [key: string]: any }
  output?: string
}

export default class LaunchDescription {
  constructor(actions?: LaunchAction[])

  addNode(action: LaunchAction): void
  getLaunchActions(): LaunchAction[]
  sendToServer(url: string): void
}
