import { CssBaseline, ThemeProvider } from "@mui/material"
import Service from "models/Service"
import { useEffect, useState } from "react"
import { Route, Routes } from "react-router-dom"
import { useStore } from "store/store"
import Dashboard from "./layout/Dashboard"
import Home from "./layout/Home"
import Network from "./layout/Network"
import Nodes from "./layout/Nodes"
import TabLayout from "./layout/TabLayout"
import WebXR from "./layout/WebXR"
import AppSidebar from "./layout/global/AppSidebar"
import Topbar from "./layout/global/Topbar"
import { ColorModeContext, useMode } from "./theme"

function App() {
  // use approriate store selectors
  const connect = useStore((state) => state.connect)
  const sendTo = useStore((state) => state.sendTo)
  const connected = useStore((state) => state.connected)
  const subscribeTo = useStore((state) => state.subscribeTo)
  const id = useStore((state) => state.id)

  const UAParser = require("ua-parser-js")
  const parser = new UAParser()
  const browser = parser.getBrowser()
  const name = "runtime"
  const version = "0.0.1"
  const typeKey = "RobotLabXUI"
  const [theme, colorMode] = useMode()
  const [isSidebar, setIsSidebar] = useState(true)

  // log all environment variables that start with REACT_APP_
  console.info("Environment variables:")
  Object.keys(process.env)
    .filter((key) => key.startsWith("REACT_APP_"))
    .forEach((key) => {
      console.log(`${key}: ${process.env[key]}`)
    })

  // INIT ! Store, network connections, etc
  useEffect(() => {
    connect()
  }, [connect])

  useEffect(() => {
    if (connected) {
      // TODO make these "service" calls ??? or at least one shot calls
      // that future callbacks are not needed
      // setup server runtime subscriptions, register this runtime, get repo
      subscribeTo("runtime", "getRegistry")
      subscribeTo("runtime", "getRepo")
      subscribeTo("runtime", "registered")
      let service = new Service(id, name, typeKey, version, browser.name.toLowerCase())
      sendTo("runtime", "register", service)
      sendTo("runtime", "getRegistry")
      sendTo("runtime", "getRepo")
    }
  }, [connected, subscribeTo, sendTo])

  return (
    <ColorModeContext.Provider value={colorMode}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <div className="app">
          <AppSidebar isSidebar={isSidebar} />
          <main className="content">
            <Topbar setIsSidebar={setIsSidebar} />
            <Routes>
              {/** TODO splash screen with examples */}
              <Route path="/" element={<Home />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/tabs" element={<TabLayout tabName="" />} />
              <Route path="/tabs/:tabName" element={<TabLayout />} />
              <Route path="/nodes/:nodeName" element={<Nodes />} />
              <Route path="/network" element={<Network />} />
              <Route path="/webxr/:tabName" element={<WebXR />} />
            </Routes>
          </main>
        </div>
      </ThemeProvider>
    </ColorModeContext.Provider>
  )
}

export default App
