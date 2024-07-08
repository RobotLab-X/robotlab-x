import LaunchAction from "../framework/LaunchAction"
export as namespace LaunchDescription

export default class LaunchDescription {
  description: string
  version: string
  actions: LaunchAction[]

  constructor(actions?: LaunchAction[])

  addNode(action: LaunchAction): void
  sendToServer(url: string): void
  serialize(format?: string): string
  toLDJS(): string
}
