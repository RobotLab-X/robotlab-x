```mermaid
sequenceDiagram
    participant client as client runtime@ui-rlx@first
    participant server as server runtime@rlx@first

    client->>client: registers self ???? where ???
    server->>server: registers self in ElectronStarter.ts
    %%Note right of server: registers self in ElectronStarter.ts
    client->>server: initial http upgrade /api/messages?id=ui-rlx
    server->>server: registers connections associates id to connection

    %%Note over client,server: added listeners
    client->>server: runtime.addListener(["getServiceNames","runtime@ui-rlx"])
    client->>server: runtime.addListener(["getService","runtime@ui-rlx"])
    client->>server: runtime.getServiceNames()

    server->>client: runtime@ui-rlx.onServiceNames <-- runtime@rlx.onServiceNames [["runtime@rlx"]]


    %%Note over client,server: added more listeners
    client->>server: runtime.addListener(["getRegistry","runtime@ui-rlx"])
    client->>server: runtime.addListener(["getRepo","runtime@ui-rlx"])
    client->>server: runtime.addListener(["registered","runtime@ui-rlx"])

    client->>server: runtime.register([{"startTime":null,"id":"ui-rlx","name":"runtime","typeKey":"RobotLabXUI","version":"0.0.1","hostname":"electron"}])

    server->>client: runtime@rlx.onRegistered [{"startTime":null,"id":"ui-rlx","name":"runtime","typeKey":"RobotLabXUI","version":"0.0.1","hostname":"electron"}]

    client->>server: runtime.getRegistry()

    server->>client: runtime@rlx.onRegistry [{"runtime@rlx":{"startTime":"2024-05-06T02:56:28.826Z","id":"rlx","name" ...

    client->>server: runtime.getRepo()

    servier->>clinet: runtime@rlx.onRepo [{"Clock":{"typeKey": ...

    client->>server: runtime.getService(["runtime@rlx"])

    server->>client: runtime@rlx.onService [{"startTime":"2024-05-06T02:56:28.826Z","id":"rlx","name":"runtime"...

    %%Note over client,server: Service A is the client sending requests.<br> Service B processes them and responds.

```


# react-express-electron-boilerplate
A boilerplate to generate an Electron app with a React Front end and an Express BackEnd embedded.

## Setup
After cloning the project run:

    yarn run install-all

## Development
To run a development version of it run

    yarn run start-dev

This will:

1. Start the React Application in the port 3000: <br />
    You can open [http://localhost:3000](http://localhost:3000) to view it in the browser.

2. Start the ExpressJS Application in the port 3001: <br />
    You can open [http://localhost:3001/products](http://localhost:3001/products) to see if it is running (should return a JSON of products).
    
3. Start the Electron App Automatically with DevTools open as default.    

### IMPORTANT
The app **WILL** reload if you make edits to the React App.

The app **WILL NOT** reload if you make edits to the ExpressJS or Electron App.

## Testing
To run a test of the whole application run

    yarn run test

To run a test of the whole application with _coverage_ run

    yarn run test-coverage
    
### NOTE
This will run tests of the React App and of the ExpressJS App

For Coverage you will find the HTML Report in the following directories:<br />
    - **React App**: `client/coverage/lcov-report/index.html` <br />
    - **Express App**: `server/coverage/lcov-report/index.html`
    
## Production Build
To run a production build, you have several options:

1. `yarn run build-all` This will create a package for MacOS, Windows and Linux.
2. `yarn run build-win` This will create a package for Windows.
3. `yarn run build-linux` This will create a package for Linux.
4. `yarn run build-mac` This will create a package for MacOS.

### NOTE
The packages will be generated in the `dist` folder.<br />
You can also find the compiled files in the `build` directory (In case you want to use the React Build in another project or only for reviewing what will Electron use for the package).


## Find Other edits

```
./node_modules/.bin/tsc -p tsconfig-build.json
```

MRL Add Listener and getServiceNames to for inquiry
```json
{
  "name": "runtime",
  "method": "addListener",
  "data": [
    "{\"topicMethod\":\"getServiceNames\",\"callbackName\":\"runtime@caring-hector\",\"callbackMethod\":\"onServiceNames\",\"class\":\"org.myrobotlab.framework.MRLListener\"}"
  ],
  "class": "org.myrobotlab.framework.Message"
}
```
```json
{
  "name": "runtime",
  "method": "getServiceNames"
}
```

```bash
curl http://192.168.0.6:11434/v1/images/generations   -H "Content-Type: application/json"     -d '{
    "model": "lama3",
    "prompt": "A cute baby sea otter",
    "n": 1,
    "size": "1024x1024"
  }'


curl http://192.168.0.6:11434/v1/images/generations   -H "Content-Type: application/json"     -d '{
    "model": "lama3",
    "prompt": "A cute baby sea otter",
    "n": 1,
    "size": "1024x1024"
  }'




curl   http://192.168.0.6:11434/v1/chat/completions -d '{
     "model": "llama3",
     "messages": [{"role": "user", "content": "hi there !"}],
     "temperature": 0.7
   }'


curl   http://192.168.0.6:11434/v1/images/generations -d '{
     "model": "llama3",
     "prompt": "A cute baby sea otter",
     "n": 1,
    "size": "1024x1024"
   }'

```
