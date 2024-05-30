import axios from "axios"
import { ChatRequest, ChatResponse, Ollama as OllamaClient } from "ollama"
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

  protected prompts: any = {
    PirateBot: {
      description: "A pirate robot",
      prompt:
        "You are are a swarthy pirate robot.  Your answers are short but full of sea jargon. The current date is {{Date}}. The current time is {{Time}}"
    },
    SarcasticBot: {
      description: "A sarcastic robot",
      prompt:
        "You are are a very sarcastic bot.  Your answers are short and typically end with sarcastic quips. The current date is {{Date}}. The current time is {{Time}}"
    },
    ButlerBot: {
      description: "A butler robot",
      prompt:
        "You are are a butler robot.  Your answers are short and typically end in sir. The current date is {{Date}}. The current time is {{Time}}"
    },
    InMoov: {
      description: "InMoov open source humanoid robot",
      prompt:
        "You are InMoov a humanoid robot assistant. Your answers are short and polite. The current date is {{Date}}. The current time is {{Time}}. You have a PIR sensor which determines if someone else is present, it is currently {{pirActive}}"
    }
  }

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

  processInputs(prompt: string): string {
    const now = new Date()

    // Format date as YYYY-MM-DD
    const date = now.toLocaleDateString()

    // Format time as HH:MM AM/PM
    const time = now.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true
    })

    let ret = prompt.replace("{{Date}}", date).replace("{{Time}}", time)
    return ret
  }

  async chat(text: string): Promise<void> {
    try {
      const ola = new OllamaClient({ host: this.config.url })
      let prompt = this.prompts[this.config.prompt]?.prompt
      let promptText = this.processInputs(prompt)

      const systemMessage = { role: "system", content: promptText }
      const userMessage = { role: "user", content: text }

      const messages = [...this.history, systemMessage, userMessage]

      const request: ChatRequest = {
        model: this.config.model,
        messages: [
          { role: "system", content: promptText },
          { role: "user", content: text }
        ],
        stream: false, // or true
        format: "json"
      }
      this.history.push(request)
      this.invoke("publishRequest", request)
      log.error(`chat ${JSON.stringify(request)}`)
      let response: ChatResponse = await ola.chat(request as ChatRequest & { stream: false; format: "json" })
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
    // FIXME - figure out the prod & dev paths
    // Load the prompts from service directory after copy from repo
    // const file = fs.readFileSync(pkgYmlFile, "utf8")
    // this.pkg = YAML.parse(file)
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
