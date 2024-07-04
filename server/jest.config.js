// server/jest.config.js

module.exports = {
  preset: "ts-jest/presets/js-with-ts",
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/**/*.test.js"],
  moduleFileExtensions: ["ts", "js"],
  rootDir: ".",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/express/$1"
  },
  transform: {
    "^.+\\.ts$": "ts-jest"
  },
  transformIgnorePatterns: ["<rootDir>/node_modules/(?!electron)", "<rootDir>/electron/"]
}
