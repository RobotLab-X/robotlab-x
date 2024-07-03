// server/jest.config.js

module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/**/*.test.(ts|js)"],
  moduleFileExtensions: ["ts", "js"],
  rootDir: ".",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/express/$1" // Adjust this to match your directory structure
  }
}
