import fs from "fs"
import path from "path"
import { Writable } from "stream"
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

interface ConsoleLog {
  filePath: string
  message: string
}

/**
 * @class Node
 * @extends Service
 * @description A service that provides node functionality and a programming interface to the RobotLab-X runtime.
 */
export default class Node extends Service {
  private intervalId: NodeJS.Timeout | null = null

  /**
   * @property {NodeConfig} config - The configuration for the node service.
   */
  config = {
    intervalMs: 5000
  }

  newScriptIncrement: number = 1

  /**
   * @property {Record<string, { content: string }>} openScripts - Dictionary of open scripts with their content.
   */
  openScripts: Record<string, { content: string }> = {}

  /**
   * @property {string[]} fileTree - An array files from scanning a directory.
   */
  fileTree: FileTreeNode[] = []

  /**
   * @property {ConsoleLog[]} consoleLogs - An array of incremental new console logs.
   */
  newLogs: ConsoleLog[] = []

  /**
   * @property {ConsoleLog[]} consoleLogs - An array window of all console logs.
   */
  consoleLogs: ConsoleLog[] = []

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

    const dirPath = path.join(main.userData, "types", "Node", "scripts")

    if (!fs.existsSync(dirPath)) {
      // Create the directory and parent directories if they don't exist
      fs.mkdirSync(dirPath, { recursive: true })
      console.log(`Directory created: ${dirPath}`)
    }
    this.scanDirectory(path.join(main.userData, "types", "Node", "scripts"))

    // launch files

    // node examples
  }

  public clearConsoleLogs(): void {
    this.newLogs = []
    this.consoleLogs = []
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
   * Merges a new subtree into the existing fileTree.
   * @param {FileTreeNode[]} existingTree - The current fileTree.
   * @param {FileTreeNode} newTree - The new subtree to merge.
   */
  private mergeFileTree(existingTree: FileTreeNode[], newTree: FileTreeNode): void {
    const findNode = (tree: FileTreeNode[], id: string): FileTreeNode | undefined => {
      for (const node of tree) {
        if (node.id === id) return node
        if (node.children) {
          const found = findNode(node.children, id)
          if (found) return found
        }
      }
      return undefined
    }

    const mergeNodes = (existingNode: FileTreeNode, newNode: FileTreeNode): void => {
      if (!existingNode.children) existingNode.children = []
      newNode.children?.forEach((newChild) => {
        const existingChild = existingNode.children!.find((child) => child.id === newChild.id)
        if (existingChild) {
          mergeNodes(existingChild, newChild) // Recursively merge child nodes
        } else {
          existingNode.children!.push(newChild) // Add new child if it doesn't exist
        }
      })
    }

    const rootNode = findNode(existingTree, newTree.id)
    if (rootNode) {
      mergeNodes(rootNode, newTree) // Merge into the existing root node
    } else {
      existingTree.push(newTree) // Add as a new root if not found
    }
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
      this.invoke("publishOpenScripts")
      log.info(`Script ${filePath} opened successfully`)
    } catch (error) {
      log.error(`Error opening script ${filePath}: ${error}`)
      throw error
    }
  }

  publishFileTree(): any {
    return this.fileTree
  }

  publishOpenScripts(): any {
    return this.openScripts
  }

  /**
   * Publishes console output for a specific script.
   */
  publishConsole(): ConsoleLog[] {
    const incrementalLogs = this.newLogs

    // move them to the consoleLogs
    this.consoleLogs.push(...this.newLogs)
    this.newLogs = []

    // trim the consoleLogs to the last 500 entries
    if (this.consoleLogs.length > 500) {
      this.consoleLogs.splice(0, this.consoleLogs.length - 500)
    }

    // publish the incremental newLogs
    return incrementalLogs
  }

  /**
   * Runs a JavaScript script in the same application context and publishes its console output.
   * @param {string} filePath - The path of the script to run.
   */
  async runScript(filePath: string): Promise<void> {
    const script = this.openScripts[filePath]
    if (!script) {
      log.error(`Script ${filePath} is not open and cannot be run`)
      throw new Error(`Script ${filePath} is not open`)
    }

    try {
      // Create a writable stream to capture console output
      const outputStream = new Writable({
        write: (chunk, encoding, callback) => {
          const message = chunk.toString().trim()
          this.newLogs.push({ filePath, message })
          callback()
        }
      })

      // Create a custom console using the writable stream
      const customConsole = new console.Console(outputStream)

      // Replace the global console with custom console
      const originalConsole = global.console
      global.console = customConsole

      try {
        // Execute the script content in the local scope using eval
        eval(script.content)
      } finally {
        // Restore the original console after execution
        global.console = originalConsole
      }

      log.info(`Script ${filePath} ran successfully`)
    } catch (error: any) {
      this.newLogs.push({ filePath, message: `ERROR: ${error.message || error}` })
      log.error(`Error running script ${filePath}: ${error}`)
      throw error
    }
  }

  /**
   * Saves the content of an open script to the file system.
   * @param {string} filePath - The path of the script to save.
   * @returns {Promise<void>} A promise that resolves when the script is saved.
   */
  async saveScript(filePath: string, content: string): Promise<void> {
    const script = this.openScripts[filePath]
    if (!script) {
      log.error(`Script ${filePath} is not open`)
      throw new Error(`Script ${filePath} is not open`)
    }

    try {
      if (content) {
        script.content = content
      }
      await writeFileAsync(filePath, script.content, "utf8")
      log.info(`Script ${filePath} ${content} saved successfully`)
    } catch (error) {
      log.error(`Error saving script ${filePath}: ${error}`)
      throw error
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

  startService(): void {
    super.startService()
    this.startLogging()
  }

  public startLogging(intervalMs?: number): void {
    if (intervalMs) {
      this.config.intervalMs = intervalMs
    }

    if (this.intervalId === null) {
      console.log(`Log.startLogging: Starting timer with interval ${this.config.intervalMs} ms`)
      this.intervalId = setInterval(async () => {
        if (this.newLogs.length > 0) {
          this.invoke("publishConsole")
        }
      }, this.config.intervalMs)
    } else {
      console.warn("Log.startLogging: Timer is already running")
    }
  }

  /**
   * Updates the content of an open script.
   * @param filePath is the path of the script to update.
   * @param content is the new content of the script.
   */
  async updateScript(filePath: string, content: string): Promise<void> {
    console.info(`updateScript ${filePath} ${content}`)
    const script = this.openScripts[filePath]
    if (!script) {
      log.error(`Script ${filePath} is not open`)
      throw new Error(`Script ${filePath} is not open`)
    }

    script.content = content
  }

  public stopLogging(): void {
    if (this.intervalId !== null) {
      console.log("Log.stopLogging: Stopping log timer")
      clearInterval(this.intervalId)
      this.intervalId = null
    } else {
      console.warn("Log.stopLogging: Log timer is not running")
    }
  }

  public newScript(
    filePath: string = path.join(
      Main.getInstance().userData,
      "types",
      "Node",
      "scripts",
      `Untitled-${this.newScriptIncrement}.js`
    )
  ): void {
    this.newScriptIncrement++
    this.writeFile(filePath, "// new cool robot script\n\n\n")
    this.openScript(filePath)
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
   * Serializes the Node instance to JSON.
   * Excludes intervalId from serialization.
   * @returns {object} The serialized Node instance.
   */
  toJSON() {
    return {
      ...super.toJSON(),
      // openScripts: Object.keys(this.openScripts), // Serialize only the keys of openScripts
      openScripts: this.openScripts,
      fileTree: this.fileTree,
      consoleLogs: this.consoleLogs
    }
  }
}
