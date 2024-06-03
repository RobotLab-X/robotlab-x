import axios from "axios"
import fs from "fs"
import { ChatRequest, ChatResponse, Ollama as OllamaClient } from "ollama"
import path from "path"
import yaml from "yaml"
import { getLogger } from "../framework/Log"
import Service from "../framework/Service"

// FIXME - should be an instance logger not a Type logger
const log = getLogger("Ollama")

export default class Ollama extends Service {
  // Class properties
  private intervalId: NodeJS.Timeout | null = null

  config = {
    installed: false,
    url: "http://localhost:11434",
    model: "llama3",
    maxHistory: 10,
    wakeWord: "wake",
    sleepWord: "sleep",
    prompt: "PirateBot"
  }

  // loaded by Ollama.ts loadPrompts
  protected prompts: any = {}

  protected history: any[] = []

  /**
   * Initializes a new instance of the Ollama service.
   * @param id - The service identifier.
   * @param name - The name of the service.
   * @param typeKey - The type key of the service.
   * @param version - The version of the service.
   * @param hostname - The hostname for the service.
   */
  constructor(id: string, name: string, typeKey: string, version: string, hostname: string) {
    super(id, name, typeKey, version, hostname)
  }

  /**
   * Sets the model to be used by the Ollama service.
   * @param model - The model name to set.
   */
  setModel(model?: string): void {
    this.config.model = model
  }

  /**
   * Applies the provided configuration to the Ollama service.
   * @param config - The configuration object to apply.
   */
  applyConfig(config: any) {
    super.applyConfig(config)
    if (this.config.installed && !this.intervalId) {
      this.startCheckTimer()
    }
  }

  /**
   * Starts a timer to periodically check the Ollama service status.
   */
  private startCheckTimer(): void {
    this.intervalId = setInterval(() => this.check(), 5000)
  }

  /**
   * Checks the status of the Ollama service.
   */
  private async check(): Promise<void> {
    try {
      const response = await axios.get(this.config.url)
      if (this.ready === false) {
        // state change to ready
        this.ready = true
        this.invoke("broadcastState")
        log.info("Ollama is ready")
      }
      log.debug(`Response from ${this.config.url}:${response.data}`)
    } catch (error) {
      if (this.ready === true) {
        // state change to not ready
        this.ready = false
        this.invoke("broadcastState")
        log.error("Ollama is not ready")
      }
      log.debug(`Error fetching from ${this.config.url}:${error}`)
    }
  }

  /**
   * Stops the timer that checks the Ollama service status.
   */
  stopCheckTimer(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }

  /**
   * Publishes the response from Ollama service.
   * @param response - The response object to publish.
   * @returns The response object.
   */
  publishResponse(response: any): any {
    log.info(`publishResponse ${JSON.stringify(response)}`)
    return response
  }

  /**
   * Publishes the chat response from Ollama service.
   * @param text - The chat response text.
   * @returns The chat response text.
   */
  publishChat(text: string): string {
    log.info(`publishChat ${text}`)
    return text
  }

  /**
   * Publishes the request sent to Ollama service.
   * @param request - The request object to publish.
   * @returns The request object.
   */
  publishRequest(request: any): any {
    log.info(`publishRequest ${JSON.stringify(request)}`)
    return request
  }

  /**
   * Processes input values and replaces placeholders in the content string.
   * @param inputs - The input values.
   * @param content - The content string with placeholders.
   * @returns The processed content string.
   */
  processInputs(inputs: any, content: string): string {
    const now = new Date()

    // Format date as YYYY-MM-DD
    const date = now.toLocaleDateString()

    // Format time as HH:MM AM/PM
    const time = now.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true
    })

    let ret = content.replace("{{Date}}", date).replace("{{Time}}", time)

    if (inputs) {
      for (const key in inputs) {
        ret = ret.replace(`{{${key}}}`, inputs[key])
      }
    }

    return ret
  }

  /**
   * Sends a chat message to the Ollama service and processes the response.
   * @param text - The chat message text.
   */
  async chat(text: string): Promise<void> {
    try {
      // create a chat client
      const oc = new OllamaClient({ host: this.config.url })
      let request: ChatRequest = null
      log.info(`chat ${this.config.prompt}`)
      let prompt = this.prompts[this.config.prompt]

      // consider calling in parallel, or different order
      // currently we'll just serially call the two chat completions
      // if tools has data
      if (prompt?.messages?.tools) {
        log.info(`tools would do a tools request`)
        // let toolsPrompt = prompt.messages.tools?.content
        // { role: "system", content: toolsPrompt + " " + JSON.stringify(prompt.tools) },

        let request: ChatRequest = {
          model: this.config.model,
          messages: [
            // { role: "system", content: JSON.stringify(prompt.tools) },
            // { role: "system", content: toolsPrompt },
            ...prompt.messages.tools,
            { role: "user", content: text }
          ],
          format: "json",
          stream: false
        }

        // get tools system prompt

        this.invoke("publishRequest", request)
        log.info(`tools chat request ${JSON.stringify(request)}`)

        let response: ChatResponse = await oc.chat(request as ChatRequest & { stream: false; format: "json" })

        log.info(`tools chat response ${JSON.stringify(response)}`)

        this.invoke("publishResponse", response)
        this.invoke("publishChat", response.message.content)
      } else {
        log.error("No tools prompt")
      }

      if (prompt?.messages?.default) {
        // call the default now with regular system prompt - no json output
        let defaultMessage = prompt.messages.default

        let promptText = this.processInputs(prompt.inputs, defaultMessage.content)

        const systemMessage = { role: "system", content: promptText }
        const userMessage = { role: "user", content: text }

        const messages = [systemMessage, ...this.history, userMessage]

        request = {
          model: this.config.model,
          messages: messages,
          stream: false
        }
        this.history.push(userMessage)
        this.invoke("publishRequest", request)
        log.info(`chat ${JSON.stringify(request)}`)

        let response: ChatResponse = await oc.chat(request as ChatRequest & { stream: false })
        this.history.push(response.message)
        this.invoke("publishResponse", response)
        this.invoke("publishChat", response.message.content)
      } else {
        log.error("No default prompt")
      }
    } catch (error) {
      log.error(`Error fetching from ${this.config.url}:${error}`)
    }
  }

  /**
   * Retrieves the response from the Ollama service.
   * @param request - The request object to send.
   */
  async getResponse(request: any): Promise<void> {
    try {
      const response = await axios.get(`${this.config.url}/chat`)
      log.info(`Response from ${this.config.url}:${response.data}`)
    } catch (error) {
      log.error(`Error fetching from ${this.config.url}:${error}`)
    }
  }

  /**
   * Sets a prompt for the Ollama service.
   * @param name - The name of the prompt.
   * @param prompt - The prompt object to set.
   */
  setPrompt(name: string, prompt: any): void {
    this.prompts[name] = prompt
  }

  /**
   * Publishes a callback from a Python response.
   * @param callback - The callback to publish.
   */
  publishPythonCall(callback: any): void {
    log.info(`publishPythonCall ${callback}`)
  }

  /**
   * Publishes a callback from a Node.js response.
   * @param callback - The callback to publish.
   */
  publishNodeCall(callback: any): void {
    log.info(`publishNodeCall ${callback}`)
  }
  loadPrompts(): void {
    log.info("loadPrompts")

    const promptsDir = path.join(this.dataPath, "prompts")
    if (!fs.existsSync(promptsDir)) {
      log.error(`Prompts directory not found: ${promptsDir}`)
      return
    }

    this.prompts = {}

    const files = fs.readdirSync(promptsDir)

    files.forEach((file) => {
      const filePath = path.join(promptsDir, file)

      if (fs.lstatSync(filePath).isFile() && path.extname(file) === ".yml") {
        const content = fs.readFileSync(filePath, "utf-8")

        const parsedContent = yaml.parse(content)
        const key = path.parse(file).name
        this.prompts[key] = parsedContent
      }
    })

    log.info("Prompts loaded successfully")
  }

  startService(): void {
    super.startService()
    // not ready
    // until connected and pinging ollama
    this.ready = false
    this.loadPrompts()
  }

  stopService(): void {
    super.stopService()
    this.stopCheckTimer()
  }

  addInput(prompt: string, key: string, value: any): void {
    this.prompts[prompt][key] = value
  }

  // FIXME .. just find a list of all Service properties  e.g. ObjectKeys(this)

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      typeKey: this.typeKey,
      version: this.version,
      hostname: this.hostname,
      config: this.config,
      notifyList: this.notifyList,
      dataPath: this.dataPath,
      prompts: this.prompts,
      ready: this.ready,
      history: this.history
    }
  }
}
