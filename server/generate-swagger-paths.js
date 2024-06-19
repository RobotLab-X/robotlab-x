const fs = require("fs")
const path = require("path")
const ts = require("typescript")
const yaml = require("yaml")
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

        const exampleTag = tags.find((tag) => tag.name === "example")
        const example = exampleTag ? JSON.parse(exampleTag.text) : null

        methods.push({ methodName, parameters, documentation, example })
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

    paths[`/${method.methodName}`] = {
      put: {
        summary: method.documentation || `Executes ${method.methodName} method`,
        description: method.documentation,
        requestBody: {
          content: {
            "application/json": {
              schema: parametersSchema,
              example: method.example ?? []
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

// Process all .ts files in a directory and generate Swagger documentation
function processDirectory(directoryPath) {
  const files = fs.readdirSync(directoryPath)
  files.forEach((file) => {
    if (path.extname(file) === ".ts") {
      const filePath = path.join(directoryPath, file)
      const methods = parseTypeScriptFile(filePath)
      const swaggerPaths = generateSwaggerPaths(methods)

      const options = {
        definition: {
          openapi: "3.0.3",
          info: {
            title: "API Documentation",
            version: "1.0.0"
          },
          servers: [
            {
              url: "http://localhost:3001/v1",
              description: "Local development server"
            }
          ],
          components: {
            schemas: schemas
          },
          paths: swaggerPaths
        },
        apis: [filePath]
      }

      const swaggerSpec = swaggerJsdoc(options)
      const outputFileName = path.basename(file, ".ts") + ".yml"
      const outputPath = path.join("./express/public/swagger", outputFileName)
      fs.writeFileSync(outputPath, yaml.stringify(swaggerSpec))

      console.log(`Swagger documentation generated for ${file} and saved to ${outputFileName}`)
    }
  })
}

// Directory containing .ts files
const directoryPath = path.resolve(__dirname, "./express/service")

// Process the directory
processDirectory(directoryPath)
