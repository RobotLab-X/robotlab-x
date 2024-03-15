import { CssBaseline, ThemeProvider } from '@mui/material'
import { useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import Dashboard from './layout/Dashboard'
import Network from './layout/Network'
import Nodes from './layout/Nodes'
import TabLayout from './layout/TabLayout'
import WebXR from './layout/WebXR'
import AppSidebar from './layout/global/AppSidebar'
import Topbar from './layout/global/Topbar'
import { ColorModeContext, useMode } from './theme'

function App() {
  // log all environment variables that start with REACT_APP_
  console.info('Environment variables:')
  Object.keys(process.env)
    .filter((key) => key.startsWith('REACT_APP_'))
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
