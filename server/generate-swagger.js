const swaggerJsdoc = require("swagger-jsdoc")
const fs = require("fs")
const yaml = require("js-yaml")

// Load the JSON schemas
const schemas = require("./schemas.json")

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
    }
  },
  apis: ["./express/service/Clock.ts"] // Path to the API docs
}

// Initialize swagger-jsdoc
const swaggerSpec = swaggerJsdoc(options)

// Write the Swagger spec to a file
fs.writeFileSync("./swagger.yml", yaml.dump(swaggerSpec))
