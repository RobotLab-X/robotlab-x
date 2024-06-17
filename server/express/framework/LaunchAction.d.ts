export default class LaunchAction {
  name: string
  package: string
  config?: { [key: string]: any }

  constructor(name: string, pkg: string, config?: { [key: string]: any })
  static fromService(service: any): LaunchAction
}
