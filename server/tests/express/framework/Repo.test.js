jest.mock("electron", () => require("@mocks/electron"))
jest.mock("../../../electron/ElectronStarter", () => ({
  expressRoot: "/mocked/express/root"
}))
jest.mock("fs")
jest.mock("path")
jest.mock("yaml")
jest.mock("../../../express/framework/Log", () => ({
  getLogger: jest.fn().mockReturnValue({
    info: jest.fn(),
    error: jest.fn()
  })
}))

const fs = require("fs")
const path = require("path")
const yaml = require("yaml")
const { Repo } = require("../../../express/framework/Repo")

// Mock Service as a class
class MockService {
  constructor(id, name, serviceType, version, hostname) {
    this.id = id
    this.name = name
    this.serviceType = serviceType
    this.version = version
    this.hostname = hostname
    this.fullname = `${name}@${id}`
    this.dataPath = null
    this.notifyList = {}
    this.pkg = null
    this.ready = false
    this.installed = false
    this.config = {}
  }
  getSubscribersForMethod = jest.fn()
  addListener = jest.fn()
  broadcastState = jest.fn()
  getConfig = jest.fn()
  applyConfig = jest.fn()
  apply = jest.fn()
  applyFileConfig = jest.fn()
  saveConfig = jest.fn()
  getNotifyList = jest.fn()
  getHostname = jest.fn()
  getId = jest.fn()
  getName = jest.fn()
  getUptime = jest.fn()
  invoke = jest.fn()
  invokeMsg = jest.fn()
  isReady = jest.fn()
  publishStdOut = jest.fn()
  releaseService = jest.fn()
  removeListener = jest.fn()
  publishStatus = jest.fn()
  publishInstallStatus = jest.fn()
  startService = jest.fn()
  stopService = jest.fn()
  info = jest.fn()
  warn = jest.fn()
  error = jest.fn()
  sendRemote = jest.fn()
  setInstalled = jest.fn()
  save = jest.fn()
  toJSON = jest.fn()
}

// Mocking Service import
jest.mock("../../../express/framework/Service", () => {
  return MockService
})

const Service = require("../../../express/framework/Service")

describe("Repo", () => {
  let repo

  beforeEach(() => {
    repo = new Repo()
    jest.clearAllMocks()
  })

  describe("load", () => {
    it("should load the repository and services", () => {
      path.join.mockReturnValue("/mocked/path")
      repo.processRepoDirectory = jest.fn()
      repo.loadServices = jest.fn()

      repo.load()

      expect(repo.processRepoDirectory).toHaveBeenCalledWith("/mocked/path")
      expect(repo.loadServices).toHaveBeenCalled()
    })
  })

  describe("getNewService", () => {
    it("should throw an error if service type does not exist", () => {
      expect(() => {
        repo.getNewService("1", "TestService", "NonExistentService", "1.0.0", "localhost")
      }).toThrow("No service found for type: NonExistentService")
    })

    it("should return a new service instance if service type exists", () => {
      repo.services["TestService"] = MockService

      const service = repo.getNewService("1", "TestService", "TestService", "1.0.0", "localhost")

      expect(service).toBeInstanceOf(MockService)
      expect(service.id).toBe("1")
      expect(service.name).toBe("TestService")
      expect(service.serviceType).toBe("TestService")
      expect(service.version).toBe("1.0.0")
      expect(service.hostname).toBe("localhost")
    })
  })

  describe("processRepoDirectory", () => {
    it("should process the repository directory and load package files", () => {
      const mockDirent = {
        isDirectory: () => true,
        name: "mockDir"
      }
      const mockRepoDirs = [mockDirent]
      const mockPackageContent = "name: MockPackage"
      const mockPackageObject = { name: "MockPackage" }

      fs.readdirSync.mockReturnValue(mockRepoDirs)
      fs.readFileSync.mockReturnValue(mockPackageContent)
      yaml.parse.mockReturnValue(mockPackageObject)
      path.join.mockReturnValue("/mocked/path/package.yml")

      const repoMap = repo.processRepoDirectory("/mocked/path")

      expect(fs.readdirSync).toHaveBeenCalledWith("/mocked/path", { withFileTypes: true })
      expect(fs.readFileSync).toHaveBeenCalledWith("/mocked/path/package.yml", "utf8")
      expect(yaml.parse).toHaveBeenCalledWith(mockPackageContent)
      expect(repoMap).toEqual({ mockDir: mockPackageObject })
    })
  })
})
