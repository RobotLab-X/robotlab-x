export class SubscriptionListener {
  public topicMethod: string | null = null
  public callbackName: string | null = null
  public callbackMethod: string | null = null

  constructor(
    topicMethod: string | null = null,
    callbackName: string | null = null,
    callbackMethod: string | null = null
  ) {
    this.topicMethod = topicMethod
    this.callbackName = callbackName
    this.callbackMethod = callbackMethod
  }
}
