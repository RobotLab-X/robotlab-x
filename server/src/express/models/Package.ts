export default class Package {
  args: string[] | null = null // ["-m", "http.server", "8000"]
  author: string | null = null // "John Doe"
  categories: string[] | null = null // ["web", "testing", "ui"]
  cmd: string | null = null // "python"
  cwd: null | string = null // "/path/to/instanceDir"
  installed: boolean = false
  dependencies: string[] | null = null
  description: string | null = null // "Node test service for testing!"
  interfaces: any[] | null = null // [{type: "rest", endpoint: "/api/v1/resource", method: "GET", description: "Retrieves list of resources."}]
  license: string | null = null // "MIT"
  platform: string | null = null // "node" | "python" | "java" | "go" | "chrome" | "electron" | "browser"
  platformVersion: string | null = null // "v12.18.3"
  proxyTypeKey: string | null = null // TestService
  repoRequirements: string[] | null = [] // requirements.txt
  requirements: string[] | null = [] // pip requirements.txt
  title: string | null = null // Test Service
  typeKey: string | null = null // TestService
  version: string | null = null // "0.0.1"
}
