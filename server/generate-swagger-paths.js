const fs = require("fs")
const path = require("path")
const ts = require("typescript")
const yaml = require("js-yaml")
const swaggerJsdoc = require("swagger-jsdoc")

// Load the JSON schemas
const schemas = require("./schemas.json")

// Function to parse TypeScript file and extract method names
function parseTypeScriptFile(filePath) {
  const program = ts.createProgram([filePath], {})
  const sourceFile = program.getSourceFile(filePath)
  const checker = program.getTypeChecker()

  const methods = []

  function visit(node) {
    if (ts.isMethodDeclaration(node)) {
      const symbol = checker.getSymbolAtLocation(node.name)
      if (symbol) {
        const methodName = symbol.getName()
        methods.push(methodName)
      }
    }
    ts.forEachChild(node, visit)
  }

  ts.forEachChild(sourceFile, visit)
  return methods
}

// Generate Swagger paths for each method
function generateSwaggerPaths(methods) {
  const paths = {}
  methods.forEach((method) => {
    paths[`/clock/${method}`] = {
      put: {
        summary: `Executes ${method} method`,
        responses: {
          200: {
            description: `${method} method executed successfully`
          }
        }
      }
    }
  })
  return paths
}

// Path to your TypeScript file
const tsFilePath = path.resolve(__dirname, "./express/service/Clock.ts")

// Parse the TypeScript file to extract method names
const methods = parseTypeScriptFile(tsFilePath)

// Generate Swagger paths
const swaggerPaths = generateSwaggerPaths(methods)

// Define the Swagger options
const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "API Documentation",
      version: "1.0.0"
    },
    components: {
      schemas: schemas
    },
    paths: swaggerPaths
  },
  apis: ["./src/Clock.ts"]
}

// Initialize swagger-jsdoc
const swaggerSpec = swaggerJsdoc(options)

// Write the Swagger spec to a file
fs.writeFileSync("./swagger.yml", yaml.dump(swaggerSpec))

console.log("Swagger documentation generated successfully!")
