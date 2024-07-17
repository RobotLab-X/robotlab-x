const fs = require("fs")
const path = require("path")
const simpleGit = require("simple-git")
const yaml = require("yaml")
const git = simpleGit()

const version = process.env.VERSION || "0.0.0"
const inputFilePath = path.join(__dirname, "express", "public", "repo", "robotlabxruntime", "package.yml")
const outputFilePath = path.join(__dirname, "dist", "express", "public", "repo", "robotlabxruntime", "package.yml")

async function generateVersionFile() {
  function ensureDirectoryExistence(filePath) {
    const dirname = path.dirname(filePath)
    if (fs.existsSync(dirname)) {
      return true
    }
    ensureDirectoryExistence(dirname)
    fs.mkdirSync(dirname)
  }

  try {
    // Read the existing YAML file
    const fileContents = fs.readFileSync(inputFilePath, "utf8")
    const packageData = yaml.parse(fileContents)

    // Get Git details
    const commitHash = await git.revparse(["HEAD"])
    const shortCommitHash = await git.revparse(["--short", "HEAD"])
    const branch = await git.branch()
    let tag = ""

    try {
      tag = await git.raw(["describe", "--tags", "--abbrev=0"])
    } catch (err) {
      tag = "No tags found"
    }

    const log = await git.log()

    // Merge new information into the package data
    const versionInfo = {
      version: version,
      commitHash: commitHash,
      shortCommitHash: shortCommitHash,
      branch: branch.current,
      tag: tag.trim(),
      lastComment: log.latest.message,
      username: log.latest.author_name
    }

    const updatedPackageData = {
      ...packageData,
      ...versionInfo
    }

    // Save the updated data to the output file
    const updatedYaml = yaml.stringify(updatedPackageData)
    ensureDirectoryExistence(outputFilePath)
    fs.writeFileSync(outputFilePath, updatedYaml)
    console.log("package.yml file updated successfully")
  } catch (err) {
    console.error("Error generating version.json file:", err)
    throw err
  }
}

generateVersionFile()
