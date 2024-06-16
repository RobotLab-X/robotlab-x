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
}

module.exports = LaunchDescription
