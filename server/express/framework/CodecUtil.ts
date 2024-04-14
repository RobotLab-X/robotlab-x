import RobotLabXRuntime from "../service/RobotLabXRuntime"
class CodecUtil {
  /**
   * Retrieves the full name by appending the runtime ID to the name if no ID is associated with the name.
   * If the name is null or the name has an ID, returns the name as is or null respectively.
   *
   * @param name - The name to process, which can be null.
   * @returns The processed name or null.
   */
  public static getFullName(name: string | null): string | null {
    if (name === null) {
      return null
    }

    if (CodecUtil.getId(name) === null) {
      return `${name}@${RobotLabXRuntime.getInstance().getId()}`
    } else {
      return name
    }
  }

  /**
   * Extracts an ID from the provided name string, assuming the ID follows an "@" symbol.
   *
   * @param name - The string from which to extract the ID.
   * @returns The ID as a string or null if no ID is present.
   */
  public static getId(name: string | null): string | null {
    if (name === null) {
      return null
    }
    const atIndex = name.lastIndexOf("@")
    if (atIndex !== -1) {
      return name.substring(atIndex + 1)
    } else {
      return null
    }
  }

  // typeScript method to get callback topic name based on topic method
  static getCallbackTopicName(topicMethod: string): string {
    // using template literals and custom method to handle string capitalization and formatting
    if (topicMethod.startsWith("publish")) {
      return `on${this.capitalize(topicMethod.substring("publish".length))}`
    } else if (topicMethod.startsWith("get")) {
      return `on${this.capitalize(topicMethod.substring("get".length))}`
    }

    // No replacement - just prefix and capitalize
    // FIXME - subscribe to onMethod --- gets ---> onOnMethod :P
    return `on${this.capitalize(topicMethod)}`
  }

  // Helper method to capitalize the first letter of a string
  static capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1)
  }
}

export { CodecUtil }
