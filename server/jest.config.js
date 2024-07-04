module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  moduleNameMapper: {
    "^@mocks/(.*)$": "<rootDir>/tests/__mocks__/$1",
    "^@express/(.*)$": "<rootDir>/express/$1",
    "^@electron/(.*)$": "<rootDir>/electron/$1",
    "^@config/(.*)$": "<rootDir>/config/$1",
    "^@tests/(.*)$": "<rootDir>/tests/$1"
  },
  transform: {
    "^.+\\.(ts|tsx)$": "ts-jest"
  },
  transformIgnorePatterns: ["/node_modules/"]
}
