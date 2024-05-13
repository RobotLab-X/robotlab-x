export default class Message {
  /**
   * Message ID - unique identifier of message
   * required only when synchronous communication is required
   * @type {string}
   */
  public msgId: string | null = null

  /**
   * Message type - type of message (e.g. synchronous service call == service)
   * @type {string}
   * @default null
   * @example
   * service
   */
  public type: string | null = null

  /**
   * clientId is an "internal" identifier for the client that sent the message,
   * its set by the process that's processing the message, not the remote process
   * @type {string}
   */
  public clientId: string | null = null

  /**
   * Service name - name of the service the message is addressed to
   * @type {string}
   */
  public name: string | null = null

  /**
   * Method name - name of the method to invoke
   * @type {string}
   */
  public method: string | null = null

  /**
   * Sender - full name of the service that sent the message
   * @type {string}
   */
  public sender: string | null = null

  /**
   * Data - array of data to pass as arguments to the method
   * @type {any[]}
   */
  public data: any[] | null = null

  constructor(name: string | null = null, method: string | null = null, data: any[]) {
    this.name = name
    this.method = method
    this.data = data
  }
}
