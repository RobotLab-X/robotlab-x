import { CodecUtil } from "../framework/CodecUtil"
import InstallerPython from "../framework/InstallerPython"
import { getLogger } from "../framework/Log"
import Service from "../framework/Service"
import Message from "../models/Message"
import RobotLabXRuntime from "./RobotLabXRuntime"

const log = getLogger("Proxy")

/**
 * General Proxy Service - a service that proxies all calls to another process id.
 * By itself its not very useful, but it allows message routing
 * to and from the target service.
 *
 * "Also" responsible for installing out of process - proxied services locally
 */
export default class Proxy extends Service {
  public proxyTypeKey: string = null

  installer: InstallerPython = null

  methodIntercepts: any = {
    addListener: "invokeMsg",
    checkPythonVersion: "invokeMsg",
    checkPipVersion: "invokeMsg",
    broadcastState: "broadcastState"
  }

  constructor(
    public id: string,
    public name: string,
    public typeKey: string,
    public version: string,
    public hostname: string
  ) {
    super(id, name, typeKey, version, hostname) // Call the base class constructor if needed
  }

  startService(): void {
    // log.info(`Starting OakD service`)
    super.startService()
    // FIXME - make an interface for installers
    // if pkg.platform === "python" then make a python installer
    this.installer = new InstallerPython(this)
    // platformInfo = installer.install(this.pkg)
    const runtime: RobotLabXRuntime = RobotLabXRuntime.getInstance()

    runtime.registerConnection(
      this.fullname,
      this.id,
      "waiting for client",
      "inbound",
      null /* ws not ready yet - client not attached */
    )
  }

  // FIXME when you stop a proxy, do you unregister the connection? - ya probably

  /**
   * Check the python version - part of necessary preparations
   * to install a python client
   */
  checkPythonVersion(): any {
    log.info("Checking python version")
    this.installer.checkPythonVersion("3.6")
  }

  /**
   * Check the pip version - part of necessary preparations
   * to install a python client
   */
  checkPipVersion(): any {
    log.info("Checking python version")
    this.installer.checkPipVersion("19.0")
  }

  /**
   * Requesting to send a message to a remote process
   * @param msg
   */
  public sendRemote(msg: Message): void {
    // initially we'll get a barrage of messages from the UI after the
    // service is first created - these are important, but cannot be
    // handled until the remote process is brought up

    // onces the remote process with the client is brought up, we might
    // need to grab and modify the connection details and routes in Runtime

    // default is runtime's sendRemote
    // RobotLabXRuntime.getInstance().sendRemote(msg)

    log.warn(`sendRemote ${this.fullname} got msg ${JSON.stringify(msg)}`)

    if (msg.method in this.methodIntercepts) {
      // TODO - extend to any method not just invokeMsg
      this.invokeMsg(msg)
    }

    // if (msg.method === "checkPythonVersion") {
    //   this.checkPythonVersion()
    // } else if (msg.method === "checkPipVersion") {
    //   this.checkPipVersion()
    // } else if (msg.method === "addListener") {
    //   this.invokeMsg(msg)
    //   // this.checkPipVersion()
    // }
  }

  /**
   * Invoke on a Proxy has a very different meaning than invoke on a "local" Service.
   * This Proxy is local and can assist in routing messages to a remote service or installing
   * a client service on the same host.  However, since its process id is different, it cannot
   * use Service.invoke.
   *
   * @param methodName
   * @param args
   * @returns
   */
  invoke(methodName: string, ...args: any[]): any {
    log.warn(`proxy invoke ${this.fullname}.${methodName}`)
    // determine if we want to invoke this on ourselves (proxy)
    // or relay it to the remote service

    // maybe all "invoked" messages are executed here and
    // simply re-written as a message to the remote service

    log.warn(`invoke ${this.fullname}.${methodName}`)
    let msg = new Message(this.name, methodName, args)
    msg.sender = this.fullname
    return this.invokeMsg(msg)
  }

  /**
   * Invoke a message on the remote service
   * Overloaded from Service, because for a proxy it means something different
   * @param msg
   */
  public invokeMsg(msg: Message): any {
    log.warn(`proxy invokeMsg ${this.fullname}.${msg.method}`)
    const msgFullName = CodecUtil.getFullName(msg.name)
    let ret: any = null

    if (msg.data && msg.data.length > 0) {
      // log.info(`--> ${msg.sender} --> ${msg.name}.${msg.method}(${JSON.stringify(msg.data)})`)
      log.info(`--> ${msg.sender} --> ${msg.name}.${msg.method}(...)`)
    } else {
      log.info(`--> ${msg.sender} --> ${msg.name}.${msg.method}()`)
    }

    // ==== LOCAL/REMOTE(ISH) ====
    // FIXME - check if blocking or non-blocking
    // is this the service to invoke the method on ?
    // if (fullName === msgFullName) {
    log.info(`(invoke) ${msgFullName}.${msg.method} from ${msg.sender}.${msg.method}`)
    let obj: any = this // cast away typescript

    if (!msg.method) {
      // ui error - user should be informed
      console.error(`method ${msg.method} not found`)
      return null
    }

    // invoke locally
    log.debug(`invoking ${this.name}.${msg.method}`)
    try {
      if (msg.data && msg.data.length > 0) {
        ret = obj[msg.method](...msg.data)
      } else {
        ret = obj[msg.method]()
      }
    } catch (e) {
      log.error(`failed to invoke ${this.name}.${msg.method} because ${e}`)
    }

    // normalize undefined to null
    if (ret === undefined) {
      ret = null
    }

    log.warn(`ret ${JSON.stringify(ret)}`)

    // TODO - process subscription
    if (this.notifyList[msg.method]) {
      log.warn("subscriber exists")
      this.notifyList[msg.method].forEach((listener: any) => {
        let subMsg = new Message(listener.callbackName, listener.callbackMethod, [ret])
        subMsg.sender = this.fullname
        // log.info(`<- notify ${listener.callbackName}.${listener.callbackMethod}`)
        RobotLabXRuntime.getInstance().sendRemote(subMsg)
        // this.invokeMsg(subMsg)
      })
    } else {
      log.warn("no subscriber")
    }
    return ret
    // }
  }

  toJSON() {
    return {
      ...super.toJSON(),
      proxyTypeKey: this.proxyTypeKey
    }
  }
}
