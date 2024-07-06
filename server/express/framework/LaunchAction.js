class LaunchAction {
  constructor(fullname, pkg, config = null) {
    this.fullname = fullname
    this.package = pkg
    this.config = config
  }

  static fromService(service) {
    return new LaunchAction(service.fullname, service.pkg.typeKey.toLowerCase(), service.config)
  }
}

// FIXME - can't get this to work
// SyntaxError: Unexpected token 'export'
// export default LaunchAction
module.exports = LaunchAction
