export class ServiceTypeData {
  public typeKey: string | null = null
  public title: string | null = null
  /**
   * Platform is the 1st dependency of the stack
   * for which the application runs on.
   * For example a node application needs to run on node.
   * A java application needs to run on the a java jvm.
   * A Linux binary needs to run in a Linux environment.
   * A ROS node needs to run in a ROS environment.
   * node, java, linux, ros are all the respective platform values.
   */
  public platform: string | null = null
  public platformVersion: string | null = null
  public description: string | null = null
  public version: string | null = null
  public interfaces: {} | null = null
  public author?: string
  public license?: string
  public language?: string
  public dependencies?: string[]
  public categories?: string[]

  constructor(typeKey: string) {
    this.typeKey = typeKey
  }
}
