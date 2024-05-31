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

  constructor(id: string, name: string, typeKey: string, version: string, hostname: string) {
    super(id, name, typeKey, version, hostname)
  }

  setModel(model?: string): void {
    this.config.model = model
  }

  applyConfig(config: any) {
    super.applyConfig(config)
    if (this.config.installed && !this.intervalId) {
      this.startCheckTimer()
    }
  }

  private startCheckTimer(): void {
    this.intervalId = setInterval(() => this.check(), 5000)
  }

  private async check(): Promise<void> {
    try {
      const response = await axios.get(this.config.url)
      log.info(`Response from ${this.config.url}:${response.data}`)
    } catch (error) {
      log.error(`Error fetching from ${this.config.url}:${error}`)
    }
  }

  stopCheckTimer(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }

  publishResponse(response: any): any {
    log.info(`publishResponse ${JSON.stringify(response)}`)
    return response
  }

  publishChat(text: string): string {
    log.info(`publishResponse ${text}`)
    return text
  }

  publishRequest(request: any): any {
    log.info(`publishRequest ${JSON.stringify(request)}`)
    return request
  }

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

  async chat(text: string): Promise<void> {
    try {
      // create a chat client
      const oc = new OllamaClient({ host: this.config.url })
      let request: ChatRequest = null
      log.info(`chat ${this.config.prompt}`)
      let prompt = this.prompts[this.config.prompt]

      // consider calling in parallel, or different order
      // currently we'll just serialally call the two chat completions
      // if tools has data
      if (prompt.tools) {
        log.info(`tools would do a tools request`)
        // request = {
        //   model: this.config.model,
        //   messages: [
        //     { role: "system", content: promptText },
        //     { role: "user", content: text }
        //   ],
        //   stream: false, // or true
        //   format: "json"
        // }
      }

      // call the default now with regular system prompt - no json output
      let defaultMessage = prompt.messages.default

      let promptText = this.processInputs(prompt.inputs, defaultMessage.content)

      const systemMessage = { role: "system", content: promptText }
      const userMessage = { role: "user", content: text }

      const messages = [...this.history, systemMessage, userMessage]

      request = {
        model: this.config.model,
        messages: [
          { role: "system", content: promptText },
          { role: "user", content: text }
        ],
        stream: false
      }
      this.history.push(request)
      this.invoke("publishRequest", request)
      log.error(`chat ${JSON.stringify(request)}`)

      let response: ChatResponse = await oc.chat(request as ChatRequest & { stream: false; format: "json" })
      this.invoke("publishResponse", response)
      this.invoke("publishChat", response.message.content)
    } catch (error) {
      log.error(`Error fetching from ${this.config.url}:${error}`)
    }
  }

  async getResponse(request: any): Promise<void> {
    try {
      const response = await axios.get(`${this.config.url}/chat`)
      log.info(`Response from ${this.config.url}:${response.data}`)
    } catch (error) {
      log.error(`Error fetching from ${this.config.url}:${error}`)
    }
  }

  setPrompt(name: string, prompt: any): void {
    this.prompts[name] = prompt
  }

  /**
   * Python callback from llm response
   * @param callback
   */
  publishPythonCall(callback: any): void {
    log.info(`publishPythonCall ${callback}`)
  }

  /**
   * Node callback from llm response
   * @param callback
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
    this.loadPrompts()
  }

  addInput(prompt: string, key: string, value: any): void {
    this.prompts[prompt][key] = value
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      typeKey: this.typeKey,
      version: this.version,
      hostname: this.hostname,
      config: this.config,
      prompts: this.prompts
    }
  }
}
