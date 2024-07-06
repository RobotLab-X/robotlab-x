jest.mock("electron", () => require("@mocks/electron"))
jest.mock("@electron/ElectronStarter", () => ({
  expressRoot: "/mocked/express/root",
  app: {
    on: jest.fn()
  },
  mainWindow: null,
  onReady: jest.fn(),
  tray: {}
}))
jest.mock("path")
jest.mock("@express/framework/Log", () => ({
  getLogger: jest.fn().mockReturnValue({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  })
}))
jest.mock("@express/service/RobotLabXRuntime", () => ({
  getInstance: jest.fn().mockReturnValue({
    applyServiceFileConfig: jest.fn(),
    saveServiceConfig: jest.fn(),
    release: jest.fn(),
    getId: jest.fn().mockReturnValue("mockedId"),
    getService: jest.fn(),
    addRoute: jest.fn(),
    getGateway: jest.fn(),
    sendRemote: jest.fn()
  })
}))

const path = require("path")
const Main = require("@electron/ElectronStarter")
const { getLogger } = require("@express/framework/Log")
const RobotLabXRuntime = require("@express/service/RobotLabXRuntime")
const { CodecUtil } = require("@express/framework/CodecUtil")
const Message = require("@express/models/Message")
const Status = require("@express/models/Status").default
const { SubscriptionListener } = require("@express/models/SubscriptionListener")
const InstallStatus = require("@express/models/InstallStatus").default
const Service = require("@express/framework/Service").default

describe("Service", () => {
  let service
  let logger

  beforeEach(() => {
    logger = getLogger()
    service = new Service("1", "clock01", "TestType", "1.0.0", "localhost")
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it("should create a service instance with correct properties", () => {
    expect(service.id).toBe("1")
    expect(service.name).toBe("clock01")
    expect(service.typeKey).toBe("TestType")
    expect(service.version).toBe("1.0.0")
    expect(service.hostname).toBe("localhost")
    expect(service.fullname).toBe("clock01@1")
    expect(service.dataPath).toBe(path.join(Main.expressRoot, "service/clock01"))
  })

  it("should return the correct notify list for a method", () => {
    const notifyList = service.getNotifyList()
    expect(notifyList).toEqual({})
  })

  it("should add a listener correctly", () => {
    const listener = service.addListener("testMethod", "remoteName", "remoteMethod")
    expect(listener.callbackName).toBe("remoteName@mockedId")
    expect(listener.callbackMethod).toBe("remoteMethod")

    const addedListener = service.notifyList["testMethod"][0]
    expect(addedListener.callbackName).toBe(listener.callbackName)
    expect(addedListener.callbackMethod).toBe(listener.callbackMethod)
  })

  it("should remove a listener correctly", () => {
    service.addListener("testMethod", "remoteName@mockedId", "remoteMethod")
    service.removeListener("testMethod", "remoteName@mockedId", "remoteMethod")
    expect(service.notifyList["testMethod"].length).toBe(0)
  })

  it("should publish status correctly", () => {
    const status = new Status("info", "test status", "clock01")
    service.publishStatus(status)
    expect(logger.info).toHaveBeenCalledWith("test status")
  })

  it("should start and stop the service", () => {
    service.startService()
    expect(service.startTime).not.toBeNull()
    expect(service.ready).toBe(true)
    service.stopService()
    expect(service.startTime).toBeNull()
    expect(service.ready).toBe(false)
  })

  it("should save config correctly", () => {
    service.saveConfig()
    const runtime = RobotLabXRuntime.getInstance()
    expect(runtime.saveServiceConfig).toHaveBeenCalledWith(service.name, service.config)
  })
})
