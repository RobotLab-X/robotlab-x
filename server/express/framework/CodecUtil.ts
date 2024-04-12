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
}

export { CodecUtil }
