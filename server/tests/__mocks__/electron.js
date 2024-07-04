// server/tests/__mocks__/electron.js

module.exports = {
  app: {
    on: jest.fn(),
    whenReady: jest.fn().mockResolvedValue(true)
  },
  BrowserWindow: jest.fn().mockImplementation(() => ({
    loadURL: jest.fn(),
    on: jest.fn(),
    webContents: {
      on: jest.fn()
    }
  })),
  Tray: jest.fn()
}
