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

        // Extract JSDoc comments
        const documentation = ts.displayPartsToString(symbol.getDocumentationComment(checker))

        // Extract JSDoc tags for parameters and return type
        const tags = symbol.getJsDocTags()
        const parameterDescriptions = {}
        let returnDescription = ""

        tags.forEach((tag) => {
          if (tag.name === "param") {
            const [paramName, ...descParts] = tag.text?.map((part) => part.text) || []
            parameterDescriptions[paramName] = descParts.join(" ").trim()
          } else if (tag.name === "returns") {
            returnDescription =
              tag.text
                ?.map((part) => part.text)
                .join(" ")
                .trim() || ""
          }
        })

        const parameters = node.parameters.map((param) => {
          const paramName = param.name.getText()
          const paramType = checker.typeToString(checker.getTypeAtLocation(param))
          return {
            name: paramName,
            type: paramType,
            description: parameterDescriptions[paramName] || `Parameter ${paramName}`
          }
        })

        const returnType = checker.getReturnTypeOfSignature(checker.getSignatureFromDeclaration(node))
        const returnTypeString = checker.typeToString(returnType)

        methods.push({
          methodName,
          parameters,
          documentation,
          example: null, // Adjust if you want to handle @example tags
          returnType: returnTypeString,
          returnDescription
        })
      }
    }
    ts.forEachChild(node, visit)
  }

  ts.forEachChild(sourceFile, visit)
  return methods
}

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

    // Create an example array of parameter names for PUT
    const parameterExample = method.parameters.map((param) => param.name)

    // Create a list of parameters for GET request
    const getParameters = method.parameters.map((param) => ({
      name: param.name, // Use the parameter's variable name
      in: "query",
      required: true,
      schema: {
        type: param.type === "number" ? "integer" : param.type
      },
      description: param.description // Use the description extracted from JSDoc
    }))

    paths[`/${method.methodName}`] = {
      put: {
        summary: method.documentation || `Executes ${method.methodName} method`,
        description: method.documentation,
        requestBody: {
          content: {
            "application/json": {
              schema: parametersSchema,
              example: parameterExample // Add the parameter names as the example
            }
          }
        },
        responses: {
          200: {
            description: method.returnDescription || `${method.methodName} executed successfully`
          }
        }
      },
      get: {
        summary: `Fetch information for ${method.methodName}`,
        description: `HTTP GET for ${method.methodName}`,
        parameters: getParameters,
        responses: {
          200: {
            description: method.returnDescription || `Details for ${method.methodName} fetched successfully`
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
// const sourcePath = path.resolve(__dirname, "./src/express/service/RobotLabXRuntime.ts")
const sourcePath = path.resolve(__dirname, "./src/express/service")

// Process the path
processDirectoryOrFile(sourcePath)
