import { HostData } from "./HostData"
import { ProcessData } from "./ProcessData"
import Service from "./Service"
import { ServiceTypeData } from "./ServiceTypeData"

export class AppData {
  // 3 keys - service name, process id, hostname

  /**
   * process id
   */
  protected id: string

  /**
   * service name
   */
  protected name: string | null = null

  /**
   * host key
   */
  protected hostname: string | null = null

  public getId() {
    return this.id
  }

  public getName() {
    return this.name
  }

  public getHostname(): string | null {
    return this.hostname
  }

  public getHost() {
    if (this.hostname == null) {
      return null
    }
    return this.hosts[this.hostname]
  }

  // full address {fqdn}.{process}.{service}.{method}/{params ... }
  // currently worky {service}@{process}.{method}/{params ... }
  // maybe {service}@{process}@{fqdn}.{method}/{params ... }  ?

  // servo@raspi4  - {serviceName}@{processName}
  protected registry: { [id: string]: Service } = {}

  // must be pid or userdefined {pid/id}
  protected processes: { [id: string]: ProcessData } = {}

  // FIXME - how to organize fqdn, hostname, ip, mac, etc. user defined?
  //  hostname or userdefined ? {hostname}
  protected hosts: { [id: string]: HostData } = {}

  // static meta data from both registered services and
  // local packages
  protected types: { [id: string]: ServiceTypeData } = {}

  constructor(name: string, id: string, hostname: string) {
    this.name = name
    this.id = id
    this.hostname = hostname
  }

  public registerHost(host: HostData) {
    this.hosts[`${host.hostname}`] = host
  }

  public registerProcess(process: ProcessData) {
    this.processes[`${process.id}@${process.host}`] = process
  }

  public registerType(type: ServiceTypeData) {
    this.types[`${type.typeKey}@${type.version}`] = type
  }

  public register(service: Service) {
    this.registry[`${service.name}@${service.id}`] = service
    // TODO - merge type info, or register minimally required type info
  }
}
