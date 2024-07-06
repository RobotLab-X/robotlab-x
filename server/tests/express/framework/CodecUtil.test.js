jest.mock("electron", () => require("@mocks/electron"))

jest.mock("../../../electron/ElectronStarter", () => ({
  expressRoot: "/mocked/express/root",
  app: {
    on: jest.fn()
  },
  mainWindow: null,
  onReady: jest.fn(),
  tray: {}
}))
jest.mock("../../../express/framework/Log", () => ({
  getLogger: jest.fn().mockReturnValue({
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  })
}))
jest.mock("../../../express/service/RobotLabXRuntime", () => ({
  getInstance: jest.fn().mockReturnValue({
    getId: jest.fn().mockReturnValue("mockedRuntimeId")
  })
}))

const { CodecUtil } = require("../../../express/framework/CodecUtil")
const RobotLabXRuntime = require("../../../express/service/RobotLabXRuntime")

describe("CodecUtil", () => {
  describe("getFullName", () => {
    it("should return null if name is null", () => {
      expect(CodecUtil.getFullName(null)).toBeNull()
    })

    it("should return name with appended runtime ID if name has no ID", () => {
      expect(CodecUtil.getFullName("testName")).toBe("testName@mockedRuntimeId")
    })

    it("should return name if name already has an ID", () => {
      expect(CodecUtil.getFullName("testName@123")).toBe("testName@123")
    })
  })

  describe("getId", () => {
    it("should return null if name is null", () => {
      expect(CodecUtil.getId(null)).toBeNull()
    })

    it('should return ID if name contains an "@" symbol', () => {
      expect(CodecUtil.getId("testName@123")).toBe("123")
    })

    it('should return null if name does not contain an "@" symbol', () => {
      expect(CodecUtil.getId("testName")).toBeNull()
    })
  })

  describe("getCallbackTopicName", () => {
    it("should return onMethod if topicMethod starts with publish", () => {
      expect(CodecUtil.getCallbackTopicName("publishTest")).toBe("onTest")
    })

    it("should return onMethod if topicMethod starts with get", () => {
      expect(CodecUtil.getCallbackTopicName("getTest")).toBe("onTest")
    })

    it("should return onMethod if topicMethod does not start with publish or get", () => {
      expect(CodecUtil.getCallbackTopicName("testMethod")).toBe("onTestMethod")
    })
  })

  describe("capitalize", () => {
    it("should capitalize the first letter of the string", () => {
      expect(CodecUtil.capitalize("test")).toBe("Test")
    })

    it("should return empty string if input is empty", () => {
      expect(CodecUtil.capitalize("")).toBe("")
    })
  })

  describe("getNpmPackageName", () => {
    it("should return rlx-pkg-type in lowercase", () => {
      expect(CodecUtil.getNpmPackageName("TestType")).toBe("rlx-pkg-testtype")
    })

    it("should log an error if type is null", () => {
      CodecUtil.getNpmPackageName(null)
      const log = require("../../../express/framework/Log").getLogger()
      expect(log.error).toHaveBeenCalledWith("Type is null")
    })
  })

  describe("getPipPackageName", () => {
    it("should return rlx_pkg_type in lowercase", () => {
      expect(CodecUtil.getPipPackageName("TestType")).toBe("rlx_pkg_testtype")
    })

    it("should log an error if type is null", () => {
      CodecUtil.getPipPackageName(null)
      const log = require("../../../express/framework/Log").getLogger()
      expect(log.error).toHaveBeenCalledWith("Type is null")
    })
  })
})
