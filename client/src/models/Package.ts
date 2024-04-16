export default class Package {
  typeKey: string | null = null // TestService
  title: string | null = null // Test Service
  /**
   * The immediate platform the service is running on, e.g. node vs browser both
   * are javascript but have different runtime environments.
   */
  platform: string | null = null // "node" | "python" | "java" | "go" | "chrome" | "electron" | "browser"
  platformVersion: string | null = null // "v12.18.3"
  description: string | null = null // "Node test service for testing!"
  version: string | null = null // "0.0.1"
  cmd: string | null = null // "python"
  args: string[] | null = null // ["-m", "http.server", "8000"]
  cwd: null | string = null // "/path/to/instanceDir"
  interfaces: any[] | null = null // [{type: "rest", endpoint: "/api/v1/resource", method: "GET", description: "Retrieves list of resources."}]
  author: string | null = null // "John Doe"
  license: string | null = null // "MIT"
  categories: string[] | null = null // ["web", "testing", "ui"]
  dependencies: string[] | null = null
}
