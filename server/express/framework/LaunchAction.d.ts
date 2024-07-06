export default class LaunchAction {
  fullname: string
  package: string
  config?: { [key: string]: any }

  constructor(fullname: string, pkg: string, config?: { [key: string]: any })
  static fromService(service: any): LaunchAction
}
