import { Box, Button, Tab, Tabs } from "@mui/material"
import "ace-builds/src-noconflict/ace"
import "ace-builds/src-noconflict/ext-language_tools"
import "ace-builds/src-noconflict/mode-javascript"
import "ace-builds/src-noconflict/theme-monokai"
import React, { useEffect, useState } from "react"
import AceEditor from "react-ace"

import { Treebeard } from "react-treebeard"
import useStore from "store/store"
import useSubscription from "store/useSubscription"

export default function Node({ fullname }) {
  console.info(`Node ${fullname}`)

  const [fileTree, setFileTree] = useState({})
  const [expanded, setExpanded] = useState(false)
  const { sendTo } = useStore()
  const [selectedScript, setSelectedScript] = useState(null)
  const service = useSubscription(fullname, "broadcastState", true)

  // Load the file tree on mount
  useEffect(() => {
    async function fetchFileTree() {
      // const files = await getScripts()
      console.info(`lastScannedFiles ${service?.lastScannedFiles}`)
      setFileTree(service?.lastScannedFiles)
    }
    // fetchFileTree()
  }, [])

  // Handler to toggle the file browser
  const toggleFileBrowser = () => setExpanded(!expanded)

  // Handler to open a script in a new tab
  const handleOpenScript = async (filePath) => {
    const content = await openScript(filePath)
    setOpenScripts((prev) => ({
      ...prev,
      [filePath]: { content }
    }))
    setSelectedScript(filePath)
  }

  // Handler to save the currently selected script
  const handleSaveScript = async (filePath) => {
    if (service?.openScripts[filePath]) {
      sendTo(fullname, "saveScript", filePath, service?.openScripts[filePath].content)
      console.info(`Script ${filePath} saved`)
    }
  }

  // Handler to close a script
  const handleCloseScript = (filePath) => {
    const newOpenScripts = { ...service?.openScripts }
    delete newOpenScripts[filePath]
    setOpenScripts(newOpenScripts)
    if (selectedScript === filePath) setSelectedScript(null)
  }

  // Handler to delete a script
  const handleDeleteScript = async (filePath) => {
    sendTo(fullname, "deleteScript", filePath)
    handleCloseScript(filePath)
  }

  // Handler to run a script
  const handleRunScript = async (filePath) => {
    sendTo(fullname, "runScript", filePath)
    console.info(`Script ${filePath} running`)
  }

  // Handler for tab change
  const handleTabChange = (event, newFilePath) => setSelectedScript(newFilePath)

  // Render the file tree structure
  const renderFileTree = (data) => <Treebeard data={data} onToggle={({ node }) => handleOpenScript(node.path)} />

  return (
    <Box display="flex" height="100%">
      {/* Collapsible File Browser */}
      <Box width={expanded ? "25%" : "5%"} display="flex" flexDirection="column">
        <Button onClick={toggleFileBrowser}>{expanded ? "Collapse" : "Expand"} Browser</Button>
        {expanded && renderFileTree(fileTree)}
      </Box>

      {/* Main Editor Section */}
      <Box width="75%" display="flex" flexDirection="column" flexGrow={1}>
        {/* Tabs for open scripts */}
        {Object.keys(service?.openScripts || {}).length > 0 && (
          <Tabs value={selectedScript || Object.keys(service?.openScripts)[0]} onChange={handleTabChange}>
            {Object.keys(service?.openScripts || {}).map((filePath) => (
              <Tab key={filePath} label={filePath} value={filePath} />
            ))}
          </Tabs>
        )}

        {/* Script Action Buttons */}
        <Box display="flex" justifyContent="space-between" padding={1}>
          <Button onClick={() => handleSaveScript(selectedScript)} disabled={!selectedScript}>
            Save
          </Button>
          <Button onClick={() => handleRunScript(selectedScript)} disabled={!selectedScript}>
            Run
          </Button>
          <Button onClick={() => handleCloseScript(selectedScript)} disabled={!selectedScript}>
            Close
          </Button>
          <Button onClick={() => handleDeleteScript(selectedScript)} disabled={!selectedScript}>
            Delete
          </Button>
        </Box>

        {/* Ace Editor for script content */}
        {selectedScript && (
          <AceEditor
            mode="javascript"
            theme="github"
            value={service?.openScripts[selectedScript]?.content || ""}
            onChange={(newContent) =>
              setOpenScripts((prev) => ({
                ...prev,
                [selectedScript]: { content: newContent }
              }))
            }
            name="script-editor"
            editorProps={{ $blockScrolling: true }}
            width="100%"
            height="100%"
          />
        )}
      </Box>
    </Box>
  )
}
