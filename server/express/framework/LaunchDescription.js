const fs = require("fs")
const path = require("path")
const yaml = require("js-yaml")
const { add } = require("winston")

/**
 * Represents a launch action with optional parameters and output settings.
 * @typedef {Object} LaunchAction
 * @property {string} package - The package name.
 * @property {string} name - The name of the action.
 * @property {string} [namespace] - Optional namespace.
 * @property {Object} [parameters] - Optional parameters as an object.
 * @property {string} [output] - Optional output setting.
 */

class LaunchDescription {
  /**
   * Creates an instance of LaunchDescription.
   * @param {LaunchAction[]} [actions] - Optional initial actions.
   */
  constructor(actions) {
    this.description = "Default description"
    this.version = "1.0"
    this.actions = actions || []
  }

  /**
   * Adds a new node action to the launch description.
   * @param {LaunchAction} action - The action to add.
   */
  addNode(action) {
    this.actions.push(action)
  }

  /**
   * Gets the launch actions.
   * @returns {LaunchAction[]} The list of actions.
   */
  getLaunchActions() {
    return this.actions
  }

  /**
   * This method would be used to send the launch description to a ROS2 capable server.
   * @param {string} url - The URL to send the launch description to.
   */
  sendToServer(url) {
    // Send the launch description to the RobotLabXRuntime
    // Implementation would likely involve an HTTP request:
    // fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.actions) })
    //     .then(response => response.json())
    //     .then(data => console.log('Server response:', data))
    //     .catch(error => console.error('Error sending data to server:', error));
  }

  toLDJS() {
    const ldtpl = fs.readFileSync(path.join(__dirname, "LaunchDescription.tpl"), "utf8")

    let launchActions = ""
    let addNodesData = ""
    // let addNodes = ""
    // const ld = new LaunchDescription()
    // ld.description = this.description
    // ld.version = this.version
    for (const [key, launchAction] of Object.entries(this.actions)) {
      console.log(`key ${key} s ${launchAction}`)
      let lsdAction = fs.readFileSync(path.join(__dirname, "LaunchAction.tpl"), "utf8")
      lsdAction = lsdAction.replaceAll("{{name}}", launchAction.name)
      // lsdAction = lsdAction.replace("{{config}}", JSON.stringify(s.config))  Maybe Future?
      lsdAction = lsdAction.replaceAll("{{package}}", launchAction.package)
      if (launchAction.config) {
        lsdAction = lsdAction.replaceAll("{{config}}", JSON.stringify(launchAction.config))
      } else {
        lsdAction = lsdAction.replaceAll("{{config}}", "")
      }

      launchActions += lsdAction

      addNodesData += "\tld.addNode(" + launchAction.name + ")\n"

      // const lsdAction = lsdActionTpl.replace("{{name}}", s.name)
      // const lsdActionConfig = lsdActionTpl.replace("{{config}}", JSON.stringify(s.config))
      // const lsdActionOutput = lsdActionTpl.replace("{{output}}", s.output)
      // const service = s as Service
      // ld.addNode({
      //   package: service.typeKey,
      //   name: service.name,
      //   config: service.config,
      //   output: service.config.output
      // })
    }

    let ldjs = ldtpl.replaceAll("{{launchActions}}", launchActions)
    ldjs = ldjs.replaceAll("{{addNodes}}", addNodesData)

    return ldjs
  }

  serialize(format = "json") {
    if (format === "json") {
      return JSON.stringify(this)
    } else if (format === "yaml") {
      return yaml.dump(this)
    } else if (format === "js") {
      return this.toLDJS()
    }
    console.error(`Invalid format ${format}`)
    return null
  }
}

module.exports = LaunchDescription
