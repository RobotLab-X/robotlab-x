import axios from "axios"
import { ChatResponse, Ollama as OllamaClient } from "ollama"
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
    sleepWord: "sleep"
  }

  constructor(
    public id: string,
    public name: string,
    public typeKey: string,
    public version: string,
    public hostname: string
  ) {
    super(id, name, typeKey, version, hostname)
  }

  public setModel(model?: string): void {
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

  public stopCheckTimer(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }

  public publishResponse(response: any): any {
    log.info(`publishResponse ${JSON.stringify(response)}`)
    return response
  }

  public publishChat(text: string): string {
    log.info(`publishResponse ${text}`)
    return text
  }

  public publishRequest(request: any): any {
    log.info(`publishRequest ${JSON.stringify(request)}`)
    return request
  }

  public async chat(text: string): Promise<void> {
    try {
      const ola = new OllamaClient({ host: this.config.url })
      let request = {
        model: this.config.model,
        messages: [{ role: "user", content: text }]
      }
      this.invoke("publishRequest", request)
      log.error(`chat ${JSON.stringify(request)}`)
      let response: ChatResponse = await ola.chat(request)
      this.invoke("publishResponse", response)
      this.invoke("publishChat", response.message.content)
    } catch (error) {
      log.error(`Error fetching from ${this.config.url}:${error}`)
    }
  }

  public async getResponse(request: any): Promise<void> {
    try {
      const response = await axios.get(`${this.config.url}/chat`)
      log.info(`Response from ${this.config.url}:${response.data}`)
    } catch (error) {
      log.error(`Error fetching from ${this.config.url}:${error}`)
    }
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      typeKey: this.typeKey,
      version: this.version,
      hostname: this.hostname,
      config: this.config
    }
  }
}
