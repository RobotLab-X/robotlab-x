# robotlab-x-installer
Installer application for RobotLab-X

## Build

### Linux
```bash
npx electron-packager . robotlab-x --platform=linux --arch=x64 --out=dist/ --overwrite
```

### Windows
```bash
npx electron-packager . robotlab-x --platform=win32 --arch=x64 --out=dist/ --overwrite
```

### macOS
```bash
npx electron-packager . robotlab-x --platform=darwin --arch=x64 --out=dist/ --overwrite
```

## Raspberry Pi
```bash
npx electron-packager . robotlab-x --platform=linux --arch=armv7l --out=dist/ --overwrite
```


