import fs from "fs"
import path from "path"
import yaml from "yaml"

export class Repo {
  processRepoDirectory(basePath: string): Map<string, any> {
    const repoMap = new Map<string, any>()
    try {
      const repoDirs = fs.readdirSync(basePath, { withFileTypes: true })

      for (const dir of repoDirs) {
        if (dir.isDirectory()) {
          const versionsPath = path.join(basePath, dir.name)
          const versionDirs = fs.readdirSync(versionsPath, {
            withFileTypes: true
          })

          for (const versionDir of versionDirs) {
            if (versionDir.isDirectory()) {
              const versionPath = path.join(versionsPath, versionDir.name)
              const packageFilePath = path.join(versionPath, "package.yml")
              // console.info(`Reading package file: ${packageFilePath}`);
              try {
                const packageFileContents = fs.readFileSync(
                  packageFilePath,
                  "utf8"
                )
                const packageObject = yaml.parse(packageFileContents)
                const key = `${dir.name}@${versionDir.name}`
                repoMap.set(key, packageObject)
              } catch (err) {
                console.error(
                  `Error reading package file in ${versionPath}: ${err}`
                )
              }
            }
          }
        }
      }
    } catch (err) {
      console.error(`Error processing repository directory: ${err}`)
    }
    return repoMap
  }

  public copyPackage(name: string, typeKey: string, version: string) {
    const source = `./express/public/repo/${typeKey}/${version}/`
    const target = `./express/public/service/${name}`

    try {
      this.copyRecursiveSync(source, target)
      console.log("Copy operation completed successfully")
    } catch (error) {
      console.error("Copy operation failed:", error)
    }
  }

  private copyRecursiveSync(src: string, dest: string) {
    console.info(`Copying ${src} to ${dest}`)

    // Check if the source exists
    if (!fs.existsSync(src)) {
      throw new Error("Source does not exist.")
    }

    const stats = fs.statSync(src)
    const isDirectory = stats.isDirectory()

    if (isDirectory) {
      // Ensure the directory exists or create it
      if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true })
      }
      const children = fs.readdirSync(src)
      for (const child of children) {
        const srcPath = path.join(src, child)
        const destPath = path.join(dest, child)
        this.copyRecursiveSync(srcPath, destPath) // Recurse for nested directories
      }
    } else {
      // Copy file
      fs.copyFileSync(src, dest)
    }
  }
}
