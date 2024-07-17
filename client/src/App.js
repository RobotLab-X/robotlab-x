import { CssBaseline, ThemeProvider } from "@mui/material"
import SwaggerUIComponent from "components/SwaggerUIComponent"
import { fetchGetJson } from "framework/fetchUtil"
import { useEffect, useState } from "react"
import { Route, Routes } from "react-router-dom"
import { useStore } from "store/store"
import Dashboard from "./layout/Dashboard"
import Home from "./layout/Home"
import Network from "./layout/Network"
import Nodes from "./layout/Nodes"
import WebXR from "./layout/WebXR"
import AppSidebar from "./layout/global/AppSidebar"
import Topbar from "./layout/global/Topbar"
import { ColorModeContext, useMode } from "./theme"

// Suppress the ResizeObserver loop error globally
window.addEventListener("error", (event) => {
  if (event.message && event.message.startsWith("ResizeObserver loop completed with undelivered notifications.")) {
    event.stopImmediatePropagation()
  }
})

window.addEventListener("unhandledrejection", (event) => {
  if (
    event.reason &&
    event.reason.message &&
    event.reason.message.startsWith("ResizeObserver loop completed with undelivered notifications.")
  ) {
    event.stopImmediatePropagation()
  }
})

/**
 * This effectively is the implementation of RobotLabXUI type "runtime"
 * TODO - needs similar properties as all services
 * @returns
 */
function App() {
  // use approriate store selectors
  const name = useStore((state) => state.name)

  const connect = useStore((state) => state.connect)
  const connected = useStore((state) => state.connected)
  const id = useStore((state) => state.id)
  const setDefaultRemoteId = useStore((state) => state.setDefaultRemoteId)

  const [theme, colorMode] = useMode()
  const [isSidebar, setIsSidebar] = useState(true)
  const getApiUrl = useStore((state) => state.getApiUrl)

  // log all environment variables that start with REACT_APP_
  console.info("Environment variables:")
  Object.keys(process.env)
    .filter((key) => key.startsWith("REACT_APP_"))
    .forEach((key) => {
      console.log(`${key}: ${process.env[key]}`)
    })

  useEffect(() => {
    if (name) {
      const fetchId = async () => {
        try {
          // important initalization
          const remoteId = await fetchGetJson(getApiUrl(), "/runtime/getId")
          console.info(`remote id ${remoteId}`)
          setDefaultRemoteId(remoteId)
          connect()
        } catch (error) {
          console.error("Error fetching id ! :", error)
        }
      }
      fetchId()
    }
  }, [name, connect, setDefaultRemoteId, getApiUrl])

  if (!connected || !id) {
    return <div>Connecting...</div>
  }

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
              <Route exact path="/" element={<Home />} />
              {/** Add /:fullname for url access to services */}

              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/nodes" element={<Nodes nodeName="" />} />
              <Route path="/nodes/:nodeId" element={<Nodes />} />
              <Route path="/swagger/:fullname" element={<SwaggerUIComponent fullname="" />} />
              <Route path="/network" element={<Network />} />
              <Route path="/webxr/:tabName" element={<WebXR />} />
              {/*}
              <Route path="*" element={<Navigate to="/" replace />} />
              */}
            </Routes>
          </main>
        </div>
      </ThemeProvider>
    </ColorModeContext.Provider>
  )
}

export default App
