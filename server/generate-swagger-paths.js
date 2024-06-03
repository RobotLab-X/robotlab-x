const fs = require("fs")
const path = require("path")
const ts = require("typescript")
const yaml = require("js-yaml")
const swaggerJsdoc = require("swagger-jsdoc")

// Load the JSON schemas
const schemas = require("./schemas.json")

// Function to parse TypeScript file and extract method names and parameters
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
        const parameters = node.parameters.map((param) => {
          const paramSymbol = checker.getSymbolAtLocation(param.name)
          const paramType = checker.getTypeAtLocation(param)
          return {
            name: paramSymbol.getName(),
            type: checker.typeToString(paramType)
          }
        })
        methods.push({ methodName, parameters })
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
    const parametersSchema = method.parameters.map((param, index) => ({
      name: `param${index + 1}`,
      in: "body",
      schema: {
        type: "object",
        properties: {
          [param.name]: { type: param.type }
        },
        required: [param.name]
      }
    }))

    paths[`/clock/${method.methodName}`] = {
      put: {
        summary: `Executes ${method.methodName} method`,
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "array",
                items: {
                  type: "object",
                  properties: method.parameters.reduce((acc, param) => {
                    acc[param.name] = { type: param.type }
                    return acc
                  }, {}),
                  required: method.parameters.map((param) => param.name)
                }
              }
            }
          }
        },
        responses: {
          200: {
            description: `${method.methodName} method executed successfully`
          }
        }
      }
    }
  })
  return paths
}

// Path to your TypeScript file
const tsFilePath = path.resolve(__dirname, "./express/service/Clock.ts")

// Parse the TypeScript file to extract method names and parameters
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
