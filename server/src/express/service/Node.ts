import fs from "fs"
import path from "path"
import util from "util"
import Main from "../../electron/Main"
import { getLogger } from "../framework/LocalLog"
import Service from "../framework/Service"

const log = getLogger("Node")

// Promisify fs functions for async usage
const readFileAsync = util.promisify(fs.readFile)
const writeFileAsync = util.promisify(fs.writeFile)
const readdirAsync = util.promisify(fs.readdir)
const statAsync = util.promisify(fs.stat)

interface FileTreeNode {
  id: string // Absolute path
  label: string // Name of the file or directory
  isDirectory: boolean // Whether the node is a directory
  modifiedDate: Date // Last modified date
  creationDate: Date // Creation date
  children?: FileTreeNode[] // Children for directories
}
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
   * @property {Record<string, { content: string }>} openScripts - Dictionary of open scripts with their content.
   */
  openScripts: Record<string, { content: string }> = {}

  /**
   * @property {string[]} fileTree - An array files from scanning a directory.
   */
  fileTree: FileTreeNode[] = []

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
    let main = Main.getInstance()
    this.scanDirectory(path.join(main.userData, "types", "Node", "scripts"))
  }

  /**
   * Adds a script to openScripts by loading its content if it's a .js file.
   * @param {string} filePath - The path of the JavaScript file to open.
   * @returns {Promise<void>} A promise that resolves when the file is added to openScripts.
   */
  async openScript(filePath: string): Promise<void> {
    if (path.extname(filePath) !== ".js") {
      log.error(`File ${filePath} is not a .js file`)
      throw new Error("Only JavaScript files (.js) can be opened")
    }

    try {
      const content: any = await readFileAsync(filePath, "utf8")
      this.openScripts[filePath] = { content }
      log.info(`Script ${filePath} opened successfully`)
    } catch (error) {
      log.error(`Error opening script ${filePath}: ${error}`)
      throw error
    }
  }

  /**
   * Saves the content of an open script to the file system.
   * @param {string} filePath - The path of the script to save.
   * @returns {Promise<void>} A promise that resolves when the script is saved.
   */
  async saveScript(filePath: string): Promise<void> {
    const script = this.openScripts[filePath]
    if (!script) {
      log.error(`Script ${filePath} is not open`)
      throw new Error(`Script ${filePath} is not open`)
    }

    try {
      await writeFileAsync(filePath, script.content, "utf8")
      log.info(`Script ${filePath} saved successfully`)
    } catch (error) {
      log.error(`Error saving script ${filePath}: ${error}`)
      throw error
    }
  }

  /**
   * Closes a script by removing it from openScripts.
   * @param {string} filePath - The path of the script to close.
   */
  closeScript(filePath: string): void {
    if (this.openScripts[filePath]) {
      delete this.openScripts[filePath]
      log.info(`Script ${filePath} closed successfully`)
    } else {
      log.warn(`Script ${filePath} is not open`)
    }
  }

  /**
   * Scans a directory synchronously and merges it with the fileTree.
   * @param {string} directoryPath - The path of the directory to scan.
   * @returns {FileTreeNode[]} The updated fileTree.
   */
  scanDirectory(
    directoryPath: string = path.join(Main.getInstance().userData, "types", "Node", "scripts")
  ): FileTreeNode[] {
    try {
      const absolutePath = path.resolve(directoryPath)
      const files = fs.readdirSync(absolutePath, { withFileTypes: true })

      const children: FileTreeNode[] = files.map((file): FileTreeNode => {
        const filePath = path.join(absolutePath, file.name)
        const stats = fs.statSync(filePath) // Get file stats synchronously
        return {
          id: filePath, // Use absolute path as the ID
          label: file.name,
          isDirectory: file.isDirectory(),
          modifiedDate: stats.mtime, // Last modified date
          creationDate: stats.birthtime, // Creation date
          children: file.isDirectory() ? [] : undefined // Initially empty for directories
        }
      })

      const newTree: FileTreeNode = {
        id: absolutePath, // Use absolute path as the ID
        label: path.basename(absolutePath),
        isDirectory: true, // The scanned directory is always a directory
        modifiedDate: fs.statSync(absolutePath).mtime, // Last modified date of the directory
        creationDate: fs.statSync(absolutePath).birthtime, // Creation date of the directory
        children
      }

      // Merge the new directory into the existing fileTree
      this.mergeFileTree(this.fileTree, newTree)

      // fileTree possibly modified - publish results
      this.invoke("publishFileTree", this.fileTree)
      return this.fileTree
    } catch (error) {
      console.error(`Error scanning directory ${directoryPath}:`, error)
      throw error
    }
  }

  /**
   * Merges a new subtree into the existing fileTree.
   * @param {FileTreeNode[]} existingTree - The current fileTree.
   * @param {FileTreeNode} newTree - The new subtree to merge.
   */
  private mergeFileTree(existingTree: FileTreeNode[], newTree: FileTreeNode): void {
    // Check if the node already exists in the current level of the tree
    const existingNode = existingTree.find((node) => node.id === newTree.id)

    if (existingNode) {
      // If the node exists, merge its children
      newTree.children?.forEach((child) => {
        const existingChild = existingNode.children?.find((c) => c.id === child.id)
        if (!existingChild) {
          existingNode.children = existingNode.children || []
          existingNode.children.push(child)
        } else if (child.children) {
          // Recursively merge child nodes
          this.mergeFileTree(existingNode.children, child)
        }
      })
    } else {
      // If the node does not exist, search deeper to find the correct parent
      for (const node of existingTree) {
        if (node.children) {
          this.mergeFileTree(node.children, newTree)
          // Stop further recursion if the newTree was merged into the existingTree
          if (node.children.some((child) => child.id === newTree.id)) {
            return
          }
        }
      }
      // Add the node to the current level only if it does not belong elsewhere
      existingTree.push(newTree)
    }
  }

  publishFileTree(): any {
    return this.fileTree
  }

  getFileTree(): any {
    return this.fileTree
  }

  /**
   * Gets the contents of a file synchronously.
   * @param {string} filePath - The path of the file.
   * @returns {string} The file contents.
   */
  getFile(filePath: string): string {
    try {
      const data = fs.readFileSync(filePath, "utf8") // Use readFileSync for synchronous reading
      return data
    } catch (error) {
      if (error instanceof Error) {
        log.error(`Error reading file ${filePath}: ${error.message}`)
      } else {
        log.error(`Error reading file ${filePath}: ${String(error)}`)
      }
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
   * Deletes a file synchronously.
   * @param {string} filePath - The path of the file to delete.
   */
  deleteFile(filePath: string): void {
    try {
      fs.unlinkSync(filePath) // Use unlinkSync for synchronous deletion
      log.info(`File deleted successfully at ${filePath}`)
    } catch (error) {
      if (error instanceof Error) {
        log.error(`Error deleting file ${filePath}: ${error.message}`)
      } else {
        log.error(`Error deleting file ${filePath}: ${String(error)}`)
      }
      throw error
    }
  }

  /**
   * Checks if a file exists synchronously.
   * @param {string} filePath - The path of the file to check.
   * @returns {boolean} True if the file exists, otherwise false.
   */
  fileExists(filePath: string): boolean {
    try {
      fs.statSync(filePath) // Use statSync to check file existence
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
      ...super.toJSON(),
      openScripts: Object.keys(this.openScripts), // Serialize only the keys of openScripts
      fileTree: this.fileTree
    }
  }
}
