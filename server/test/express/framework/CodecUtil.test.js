import { describe, expect, it, vi } from "vitest"
import { CodecUtil } from "../../../express/framework/CodecUtil"
// const RobotLabXRuntime = require("../../../express/service/RobotLabXRuntime")

// Mocking RobotLabXRuntime
vi.mock("../../../express/service/RobotLabXRuntime", () => {
  return {
    default: {
      // Ensure to mock the default export if that's how it's used in your actual code
      getInstance: () => {
        return {
          getId: vi.fn(() => "1001") // Explicitly return the mock function
        }
      }
    }
  }
})

describe("CodecUtil", () => {
  describe("getFullName", () => {
    it("should return null if the name is null", () => {
      expect(CodecUtil.getFullName(null)).toBeNull()
    })

    it("should append runtime ID if no ID is associated with the name", () => {
      expect(CodecUtil.getFullName("Alice")).toBe("Alice@1001")
    })

    it("should return the name as is if it already has an ID", () => {
      expect(CodecUtil.getFullName("Alice@1234")).toBe("Alice@1234")
    })
  })

  describe("getId", () => {
    it("should return null if the name is null", () => {
      expect(CodecUtil.getId(null)).toBeNull()
    })

    it('should return null if no "@" symbol is present', () => {
      expect(CodecUtil.getId("Alice")).toBeNull()
    })

    it('should extract the ID if "@" symbol is present', () => {
      expect(CodecUtil.getId("Alice@1234")).toBe("1234")
    })
  })

  describe("getCallbackTopicName", () => {
    it('should prefix with "on" and capitalize the method name after "publish"', () => {
      expect(CodecUtil.getCallbackTopicName("publishEvent")).toBe("onEvent")
    })

    it('should prefix with "on" and capitalize the method name after "get"', () => {
      expect(CodecUtil.getCallbackTopicName("getEvent")).toBe("onEvent")
    })

    it('should handle method names without known prefixes by just adding "on"', () => {
      expect(CodecUtil.getCallbackTopicName("invokeEvent")).toBe("onInvokeEvent")
    })
  })
})
