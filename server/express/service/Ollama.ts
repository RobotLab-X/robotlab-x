import { getLogger } from "../framework/Log"
import Service from "../framework/Service"

// FIXME - should be an instance logger not a Type logger
const log = getLogger("Ollama")

export default class Ollama extends Service {
  // Class properties
  private intervalId: NodeJS.Timeout | null = null
  // private intervalMs: number = 1000
  config = {
    installed: false,
    url: "http://localhost:11434/v1/chat/completions"
  }

  constructor(
    public id: string,
    public name: string,
    public typeKey: string,
    public version: string,
    public hostname: string
  ) {
    super(id, name, typeKey, version, hostname) // Call the base class constructor if needed
    // this.config = { intervalMs: 1000 }
  }
}
