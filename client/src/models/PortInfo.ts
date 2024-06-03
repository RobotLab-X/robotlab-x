export default class PortInfo {
  fullname: string = ""
  ports: string[] = []
  port: string = ""
  isConnected: boolean = false

  constructor(fullname?: string, ports?: string[], port?: string, isConnected?: boolean) {
    this.fullname = fullname ?? this.fullname
    this.ports = ports ?? this.ports
    this.port = port ?? this.port
    this.isConnected = isConnected ?? this.isConnected
  }
}
