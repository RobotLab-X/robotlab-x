import { useState } from "react"
import { Routes, Route } from "react-router-dom"
import Topbar from "./layout/global/Topbar"
import AppSidebar from "./layout/global/AppSidebar"
import Dashboard from "./layout/Dashboard"
import TabLayout from "./layout/TabLayout"
import Network from "./layout/Network"
import Graph from "./layout/Graph"
import Bar from "./scenes/bar"
import Form from "./scenes/form"
import Line from "./scenes/line"
import Pie from "./scenes/pie"
import FAQ from "./scenes/faq"
import Geography from "./scenes/geography"
import { CssBaseline, ThemeProvider } from "@mui/material"
import { ColorModeContext, useMode } from "./theme"
import Calendar from "./scenes/calendar/calendar"
import WebXR from "./layout/WebXR"

function App() {
  // log all environment variables that start with REACT_APP_
  console.info("Environment variables:")
  Object.keys(process.env)
    .filter((key) => key.startsWith("REACT_APP_"))
    .forEach((key) => {
      console.log(`${key}: ${process.env[key]}`)
    })

  const [theme, colorMode] = useMode()
  const [isSidebar, setIsSidebar] = useState(true)

  return (
    <ColorModeContext.Provider value={colorMode}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <div className="app">
          <AppSidebar isSidebar={isSidebar} />
          <main className="content">
            <Topbar setIsSidebar={setIsSidebar} />
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/tabs" element={<TabLayout tabName="" />} />
              <Route path="/tabs/:tabName" element={<TabLayout />} />
              <Route path="/graph" element={<Graph />} />
              <Route path="/network" element={<Network />} />
              <Route path="/webxr/:tabName" element={<WebXR />} />
              <Route path="/bar" element={<Bar />} />
              <Route path="/form" element={<Form />} />
              <Route path="/pie" element={<Pie />} />
              <Route path="/line" element={<Line />} />
              <Route path="/faq" element={<FAQ />} />
              <Route path="/calendar" element={<Calendar />} />
              <Route path="/geography" element={<Geography />} />
            </Routes>
          </main>
        </div>
      </ThemeProvider>
    </ColorModeContext.Provider>
  )
}

export default App
