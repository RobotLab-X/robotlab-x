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
              // console.info(`Reading package file: ${packageFilePath}`)
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

  public async copyPackage(name: string, typeKey: string, version: string) {
    // const source = path.join(
    //   __dirname,
    //   `./express/public/repo/${typeKey}/${version}/`
    // )
    // const target = path.join(__dirname, `./express/public/service/${name}`)
    const source = `./express/public/repo/${typeKey}/${version}/`
    const target = `./express/public/service/${name}`

    try {
      await this.copyRecursiveAsync(source, target)
      console.log("Copy operation completed successfully")
    } catch (error) {
      console.error("Copy operation failed:", error)
    }
  }

  private async copyRecursiveAsync(src: string, dest: string) {
    try {
      console.info(`copying ${src} to ${dest}`)

      // Check if the source exists
      const stats = await fs.stat(src).catch(() => null)
      if (!stats) {
        throw new Error("Source does not exist.")
      }

      const isDirectory = stats.isDirectory()

      if (isDirectory) {
        // Ensure the directory exists or create it
        await fs.mkdir(dest, { recursive: true })
        const children = await fs.readdir(src)
        for (const child of children) {
          const srcPath = path.join(src, child)
          const destPath = path.join(dest, child)
          await this.copyRecursiveAsync(srcPath, destPath)
        }
      } else {
        // Copy file
        await fs.copyFile(src, dest)
      }
    } catch (error) {
      // Handle errors, possibly re-throw or log
      throw error
    }
  }

  // public copyPackage(name: string, typeKey: string, version: string) {

  //   const source = path.join(
  //     __dirname,
  //     `./express/public/repo/${typeKey}/${version}/`
  //   )
  //   const target = path.join(__dirname, `./express/public/service/${name}`)

  //   // Check if the destination directory exists
  //   if (fs.existsSync(dest)) {
  //     console.log('Target directory already exists. Copy operation skipped.');
  //     return; // Exit the function early if the target directory exists
  //   }

  //   const exists = fs.existsSync(src);
  //   const stats = exists && fs.statSync(src);
  //   const isDirectory = exists && stats.isDirectory();

  //   if (isDirectory) {
  //     fs.mkdirSync(dest, { recursive: true });
  //     fs.readdirSync(src).forEach(function(childItemName) {
  //       copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
  //     });
  //   } else {
  //     fs.copyFileSync(src, dest);
  //   }
  // }

  // public async copyPackage(name: string, typeKey: string, version: string) {
  //   const repoMap = new Map()
  //   try {
  //     const source = path.join(
  //       __dirname,
  //       `./express/public/repo/${typeKey}/${version}/`
  //     )
  //     const target = path.join(__dirname, `./express/public/service/${name}`)

  //     if (fs.access(target)) {
  //       console.log(`named service directory exists - not copying ${target}`)
  //       return true
  //     }

  //     await fs.cp(source, target, { recursive: true })
  //     console.log(`directory copied from ${source} to ${target}`)
  //     return true
  //   } catch (error) {
  //     console.error("error copying directory:", error)
  //   }
  //   return repoMap
  // }
}
