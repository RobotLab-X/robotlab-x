import fs from "fs/promises"
import path from "path"
import yaml from "yaml"

export class Repo {
  public async processRepoDirectory(basePath: string) {
    const repoMap = new Map()
    try {
      const repoDirs = await fs.readdir(basePath, { withFileTypes: true })

      for (const dir of repoDirs) {
        if (dir.isDirectory()) {
          const versionsPath = path.join(basePath, dir.name)
          const versionDirs = await fs.readdir(versionsPath, {
            withFileTypes: true
          })

          for (const versionDir of versionDirs) {
            if (versionDir.isDirectory()) {
              const versionPath = path.join(versionsPath, versionDir.name)
              const packageFilePath = path.join(versionPath, "package.yml")

              try {
                const packageFileContents = await fs.readFile(
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
}
