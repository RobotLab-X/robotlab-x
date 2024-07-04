const app = {
  getPath: jest.fn().mockReturnValue("/mocked/path")
  // Add other functions if needed
}

const BrowserWindow = jest.fn()

const electron = {
  app,
  BrowserWindow
  // Add other parts of electron if needed
}

module.exports = electron
