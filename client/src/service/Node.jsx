import { Box, Button, Tab, Tabs } from "@mui/material"
import { RichTreeView } from "@mui/x-tree-view/RichTreeView"
import "ace-builds/src-noconflict/ace"
import "ace-builds/src-noconflict/ext-language_tools"
import "ace-builds/src-noconflict/mode-javascript"
import "ace-builds/src-noconflict/theme-monokai"
import React, { useState } from "react"
import AceEditor from "react-ace"
import useStore from "store/store"
import useSubscription from "store/useSubscription"

export default function Node({ fullname }) {
  console.info(`Node ${fullname}`)

  const service = useSubscription(fullname, "broadcastState", true)
  const [expanded, setExpanded] = useState(false)
  const { sendTo } = useStore()
  const [selectedScript, setSelectedScript] = useState(null)
  const [openScripts, setOpenScripts] = useState({}) // Stores open scripts and their content
  const fileTree = useSubscription(fullname, "publishFileTree", true)

  // Handler to toggle the file browser
  const toggleFileBrowser = () => setExpanded(!expanded)

  // Handler to open a script in a new tab
  const handleOpenScript = async (filePath, label) => {
    if (!openScripts[filePath]) {
      const content = await sendTo(fullname, "openScript", filePath) // Fetch script content
      setOpenScripts((prev) => ({
        ...prev,
        [filePath]: { label, content }
      }))
    }
    setSelectedScript(filePath)
  }

  // Handler to save the currently selected script
  const handleSaveScript = async (filePath) => {
    if (openScripts[filePath]) {
      sendTo(fullname, "saveScript", filePath, openScripts[filePath].content)
      console.info(`Script ${filePath} saved`)
    }
  }

  // Handler to close a script
  const handleCloseScript = (filePath) => {
    const { [filePath]: _, ...remainingScripts } = openScripts
    setOpenScripts(remainingScripts)
    if (selectedScript === filePath) {
      setSelectedScript(Object.keys(remainingScripts)[0] || null)
    }
  }

  // Handler for tab change
  const handleTabChange = (event, newFilePath) => setSelectedScript(newFilePath)

  // Utility to find a node by its ID in the file tree
  const findNodeById = (nodes, id) => {
    for (const node of nodes) {
      if (node.id === id) return node
      if (node.children) {
        const found = findNodeById(node.children, id)
        if (found) return found
      }
    }
    return null
  }

  // Handle item click in the file tree
  const handleItemClick = (event, nodeId) => {
    const selectedNode = findNodeById(fileTree, nodeId)
    if (selectedNode) {
      if (selectedNode.isDirectory) {
        sendTo(fullname, "scanDirectory", nodeId)
      } else {
        handleOpenScript(nodeId, selectedNode.label)
      }
    }
  }

  // Render the file tree structure
  const renderFileTree = (data) => (
    <RichTreeView items={data} onItemClick={(event, nodeId) => handleItemClick(event, nodeId)} />
  )

  return (
    <Box display="flex" height="100%">
      {/* Collapsible File Browser */}
      <Box width={expanded ? "25%" : "5%"} display="flex" flexDirection="column">
        <Button onClick={toggleFileBrowser}>{expanded ? "Collapse" : "Expand"} Browser</Button>
        {expanded && renderFileTree(fileTree || [])}
      </Box>

      {/* Main Editor Section */}
      <Box width={expanded ? "75%" : "95%"} display="flex" flexDirection="column" flexGrow={1}>
        {/* Tabs for open scripts */}
        {Object.keys(openScripts).length > 0 && (
          <Tabs value={selectedScript} onChange={handleTabChange}>
            {Object.keys(openScripts).map((filePath) => (
              <Tab key={filePath} label={openScripts[filePath].label} value={filePath} />
            ))}
          </Tabs>
        )}

        {/* Script Action Buttons */}
        {selectedScript && (
          <Box display="flex" justifyContent="space-between" padding={1}>
            <Button onClick={() => handleSaveScript(selectedScript)}>Save</Button>
            <Button onClick={() => sendTo(fullname, "runScript", selectedScript)}>Run</Button>
            <Button onClick={() => handleCloseScript(selectedScript)}>Close</Button>
            <Button onClick={() => sendTo(fullname, "deleteScript", selectedScript)}>Delete</Button>
          </Box>
        )}

        {/* Ace Editor for script content */}
        {selectedScript && openScripts[selectedScript] && (
          <AceEditor
            mode="javascript"
            theme="monokai"
            value={openScripts[selectedScript].content}
            onChange={(newContent) =>
              setOpenScripts((prev) => ({
                ...prev,
                [selectedScript]: { ...prev[selectedScript], content: newContent }
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
