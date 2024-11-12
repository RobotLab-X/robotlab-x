import fs from "fs"
import path from "path"
import util from "util"
import { getLogger } from "../framework/LocalLog"
import Service from "../framework/Service"

const log = getLogger("Node")

// Promisify fs functions for async usage
const readFileAsync = util.promisify(fs.readFile)
const writeFileAsync = util.promisify(fs.writeFile)
const readdirAsync = util.promisify(fs.readdir)
const statAsync = util.promisify(fs.stat)

const openScripts = {}

/**
 * @class Node
 * @extends Service
 * @description A service that provides node functionality and a programming interface to the RobotLab-X runtime.
 */
export default class Node extends Service {
  /**
   * @property {NodeConfig} config - The configuration for the node service.
   */
  config = {}

  /**
   * Creates an instance of Node.
   * @param {string} id - The unique identifier for the service.
   * @param {string} name - The name of the service.
   * @param {string} typeKey - The type key of the service.
   * @param {string} version - The version of the service.
   * @param {string} hostname - The hostname of the service.
   */
  constructor(
    public id: string,
    public name: string,
    public typeKey: string,
    public version: string,
    public hostname: string
  ) {
    super(id, name, typeKey, version, hostname)
  }

  /**
   * Stops the Node service.
   */
  stopService(): void {
    super.stopService()
  }

  /**
   * Scans a directory and retrieves a list of files.
   * @param {string} directoryPath - The path of the directory to scan.
   * @returns {Promise<string[]>} A promise that resolves to an array of file paths.
   */
  async scanDirectory(directoryPath: string = "."): Promise<string[]> {
    try {
      const files = await readdirAsync(directoryPath)
      return files.map((file) => path.join(directoryPath, file))
    } catch (error) {
      log.error(`Error scanning directory ${directoryPath}: ${error}`)
      throw error
    }
  }

  /**
   * Gets the contents of a file.
   * @param {string} filePath - The path of the file.
   * @returns {Promise<string>} A promise that resolves to the file contents.
   */
  async getFile(filePath: string): Promise<string> {
    try {
      const data = await readFileAsync(filePath, "utf8")
      return data
    } catch (error) {
      log.error(`Error reading file ${filePath}: ${error}`)
      throw error
    }
  }

  /**
   * Writes data to a file.
   * @param {string} filePath - The path of the file.
   * @param {string} data - The data to write.
   * @returns {Promise<void>} A promise that resolves when the file is written.
   */
  async writeFile(filePath: string, data: string): Promise<void> {
    try {
      await writeFileAsync(filePath, data, "utf8")
      log.info(`File written successfully at ${filePath}`)
    } catch (error) {
      log.error(`Error writing file ${filePath}: ${error}`)
      throw error
    }
  }

  /**
   * Deletes a file.
   * @param {string} filePath - The path of the file to delete.
   * @returns {Promise<void>} A promise that resolves when the file is deleted.
   */
  async deleteFile(filePath: string): Promise<void> {
    try {
      await fs.promises.unlink(filePath)
      log.info(`File deleted successfully at ${filePath}`)
    } catch (error) {
      log.error(`Error deleting file ${filePath}: ${error}`)
      throw error
    }
  }

  /**
   * Checks if a file exists.
   * @param {string} filePath - The path of the file to check.
   * @returns {Promise<boolean>} A promise that resolves to true if the file exists, otherwise false.
   */
  async fileExists(filePath: string): Promise<boolean> {
    try {
      await statAsync(filePath)
      return true
    } catch {
      return false
    }
  }

  /**
   * Serializes the Node instance to JSON.
   * Excludes intervalId from serialization.
   * @returns {object} The serialized Node instance.
   */
  toJSON() {
    return {
      ...super.toJSON()
    }
  }
}
