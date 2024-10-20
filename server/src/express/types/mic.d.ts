declare module "mic" {
  interface MicOptions {
    rate: string
    channels: string
    debug?: boolean
    exitOnSilence?: number
    device?: string
  }

  interface MicInstance {
    start: () => void
    stop: () => void
    getAudioStream: () => NodeJS.ReadableStream
  }

  function mic(options?: MicOptions): MicInstance

  export = mic
}
