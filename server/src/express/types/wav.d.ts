declare module "wav" {
  import { Writable } from "stream"

  interface FileWriterOptions {
    sampleRate: number
    channels: number
  }

  class FileWriter extends Writable {
    constructor(path: string, options?: FileWriterOptions)
  }

  export { FileWriter }
}
