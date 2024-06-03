const fs = require("fs")
const path = require("path")
const ts = require("typescript")
const yaml = require("js-yaml")
const swaggerJsdoc = require("swagger-jsdoc")

// Load the JSON schemas
const schemas = require("./schemas.json")

// Function to parse TypeScript file and extract method names, parameters, and TSDoc comments
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
          const paramType = checker.getTypeAtLocation(param)
          return checker.typeToString(paramType)
        })

        let documentation = ts.displayPartsToString(symbol.getDocumentationComment(checker))

        // Get tags from the jsdoc
        const tags = symbol.getJsDocTags().map((tag) => ({
          name: tag.name,
          text: tag.text ? ts.displayPartsToString(tag.text) : undefined
        }))

        methods.push({ methodName, parameters, documentation, tags })
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
    const parametersSchema = {
      type: "array",
      items: method.parameters.map((param) => ({
        type: param === "number" ? "integer" : param
      }))
    }

    paths[`/ollama/${method.methodName}`] = {
      put: {
        summary: method.documentation || `Executes ${method.methodName} method`,
        description: method.documentation,
        requestBody: {
          content: {
            "application/json": {
              schema: parametersSchema,
              example: method.parameters.map((param, index) => {
                if (param === "number") return index
                if (param === "string") return `example${index}`
                return null
              })
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
const tsFilePath = path.resolve(__dirname, "./express/service/Ollama.ts")

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
  apis: ["./src/Ollama.ts"]
}

// Initialize swagger-jsdoc
const swaggerSpec = swaggerJsdoc(options)

// Write the Swagger spec to a file
fs.writeFileSync("./swagger.yml", yaml.dump(swaggerSpec))

console.log("Swagger documentation generated successfully!")
