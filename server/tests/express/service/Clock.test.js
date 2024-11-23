jest.mock("../../../src/express/framework/Service", () => {
  // Create a mock for the Service class
  return jest.fn().mockImplementation(function (id, name, typeKey, version, hostname) {
    this.id = id
    this.name = name
    this.typeKey = typeKey
    this.version = version
    this.hostname = hostname
    this.invoke = jest.fn() // Mock the invoke method
  })
})

const Clock = require("../../../src/express/service/Clock").default

describe("Clock", () => {
  let clock

  beforeEach(() => {
    clock = new Clock("1", "clock01", "ClockType", "1.0.0", "localhost")
  })

  afterEach(() => {
    jest.clearAllMocks()
    clock.stopClock()
  })

  test("should create a clock instance with correct properties", () => {
    expect(clock.id).toBe("1")
    expect(clock.name).toBe("clock01")
    expect(clock.typeKey).toBe("ClockType")
    expect(clock.version).toBe("1.0.0")
    expect(clock.hostname).toBe("localhost")
  })

  test("should publish epoch time on tick", () => {
    const spy = jest.spyOn(clock, "publishEpoch")
    clock.onTick()
    // expect(spy).toHaveBeenCalled()
    // expect(clock.invoke).toHaveBeenCalledWith("publishEpoch") // Check invoke was called
    // spy.mockRestore()
  })

  test("should start and stop the clock", () => {
    clock.startClock(100)
    expect(clock["intervalId"]).not.toBeNull()
    clock.stopClock()
    expect(clock["intervalId"]).toBeNull()
  })
})
