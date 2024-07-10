class LaunchAction {
  constructor(name, pkg, config = null) {
    this.name = name
    this.package = pkg
    this.config = config
    this.listeners = listeners
  }

  static fromService(service) {
    return new LaunchAction(service.name, service.pkg.typeKey.toLowerCase(), service.config)
  }
}

// FIXME - can't get this to work
// SyntaxError: Unexpected token 'export'
// export default LaunchAction
module.exports = LaunchAction
