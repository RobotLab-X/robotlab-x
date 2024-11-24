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
          const paramName = param.name.getText() // Get the parameter's variable name
          return {
            name: paramName,
            type: checker.typeToString(paramType)
          }
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
// Generate Swagger paths for each method
function generateSwaggerPaths(methods) {
  // Sort methods alphabetically by method name
  methods.sort((a, b) => a.methodName.localeCompare(b.methodName))

  const paths = {}
  methods.forEach((method) => {
    // Create a schema for the method's parameters for PUT request
    const parametersSchema = {
      type: "array",
      items: method.parameters.map((param) => ({
        type: param.type === "number" ? "integer" : param.type
      }))
    }

    // Create a list of parameters for GET request
    const getParameters = method.parameters.map((param) => ({
      name: param.name, // Use the parameter's variable name
      in: "query",
      required: true,
      schema: {
        type: param.type === "number" ? "integer" : param.type
      },
      description: `Parameter ${param.name} for ${method.methodName}`
    }))

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
      },
      get: {
        summary: `Fetch information for ${method.methodName}`,
        description: `HTTP GET for ${method.methodName}`,
        parameters: getParameters,
        responses: {
          200: {
            description: `Details for ${method.methodName} fetched successfully`
          }
        }
      }
    }
  })
  return paths
}

// Process TypeScript file and generate Swagger documentation
function processFile(filePath) {
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
  const outputFileName = path.basename(filePath, ".ts") + ".yml"
  const outputPath = path.join("./src/express/public/swagger", outputFileName)
  fs.writeFileSync(outputPath, yaml.stringify(swaggerSpec))

  console.log(`Swagger documentation generated for ${filePath} and saved to ${outputFileName}`)
}

// Process all .ts files in a directory or a single file
function processDirectoryOrFile(sourcePath) {
  const stats = fs.statSync(sourcePath)

  if (stats.isDirectory()) {
    const files = fs.readdirSync(sourcePath)
    files.forEach((file) => {
      if (path.extname(file) === ".ts") {
        const filePath = path.join(sourcePath, file)
        processFile(filePath)
      }
    })
  } else if (stats.isFile() && path.extname(sourcePath) === ".ts") {
    processFile(sourcePath)
  } else {
    console.log(`${sourcePath} is not a valid TypeScript file or directory.`)
  }
}

// Path to source file or directory
const sourcePath = path.resolve(__dirname, "./src/express/service/Node.ts")

// Process the path
processDirectoryOrFile(sourcePath)
