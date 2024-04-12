export default class Message {
  /**
   * Message ID - unique identifier of message
   * required only when synchronous communication is required
   * @type {string}
   */
  public msgId: string | null = null

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
}
