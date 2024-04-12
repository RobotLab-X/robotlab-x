import { Server as WebSocketServer } from "ws"

type RegistryType = { [key: string]: any }

export default class Store {
  private static instance: Store

  protected wss: WebSocketServer
  private registry: RegistryType = {}

  // Private constructor to prevent external instantiation directly
  private constructor() {}

  // Static method to get the instance of the class
  public static getInstance(): Store {
    if (!Store.instance) {
      Store.instance = new Store()
    }
    return Store.instance
  }

  // Method to get a value by key from the registry
  public getRegistry(): any {
    return this.registry
  }

  public getService(key: string): any {
    return this.registry[key]
  }

  // Method to set a key-value pair in the registry
  public register(key: string, value: any): void {
    this.registry[key] = value
  }

  // Optional: Method to clear the registry or remove a key
  public clear(key?: string): void {
    if (key) {
      delete this.registry[key]
    } else {
      this.registry = {}
    }
  }
}
