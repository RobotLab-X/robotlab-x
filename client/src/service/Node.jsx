import { ChevronLeft, ChevronRight, Close, Delete, PlayArrow, Save } from "@mui/icons-material"
import { Box, IconButton, Tab, Tabs, Tooltip } from "@mui/material"
import { RichTreeView } from "@mui/x-tree-view/RichTreeView"
import "ace-builds/src-noconflict/ace"
import "ace-builds/src-noconflict/ext-language_tools"
import "ace-builds/src-noconflict/mode-javascript"
import "ace-builds/src-noconflict/theme-monokai"
import React, { useState } from "react"
import AceEditor from "react-ace"
import "react-resizable/css/styles.css"
import useStore from "store/store"
import useSubscription from "store/useSubscription"

export default function Node({ fullname }) {
  console.info(`Node ${fullname}`)

  const service = useSubscription(fullname, "broadcastState", true)
  const [expanded, setExpanded] = useState(false)
  const { sendTo } = useStore()
  const [selectedScript, setSelectedScript] = useState(null)
  const fileTree = useSubscription(fullname, "publishFileTree", true)
  const openScripts = useSubscription(fullname, "publishOpenScripts", true)
  const publishConsole = useSubscription(fullname, "publishConsole")
  // const [consoleLog, setConsoleLog] = useState([])

  // useEffect(() => {
  //   if (publishConsole) {
  //     // Append new message only if it's not already in the consoleLog
  //     setConsoleLog((prevLog) => {
  //       if (prevLog[prevLog.length - 1] === publishConsole) return prevLog // Prevent duplicates
  //       return [...prevLog, publishConsole]
  //     })
  //   }
  // }, [publishConsole]) // Trigger effect whenever publishConsole changes

  // Handler to toggle the file browser
  const toggleFileBrowser = () => setExpanded(!expanded)

  // Handler to open a script in a new tab
  const handleOpenScript = async (filePath, label) => {
    sendTo(fullname, "openScript", filePath) // Fetch script content
    setSelectedScript(filePath)
  }

  // Handler to save the currently selected script
  const handleSaveScript = (filePath, newContent) => {
    if (openScripts[filePath]) {
      if (newContent) {
        sendTo(fullname, "saveScript", filePath, newContent)
      } else {
        sendTo(fullname, "saveScript", filePath, openScripts[filePath].content)
      }
      console.info(`Script ${filePath} saved`)
    }
  }

  const handleCloseScript = (filePath) => {
    sendTo(fullname, "closeScript", filePath)
    sendTo(fullname, "publishOpenScripts")
    delete openScripts[filePath] // Remove the closed script locally
    setSelectedScript(Object.keys(openScripts)[0] || null)
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

  const getFileName = (filePath) => filePath.split(/[/\\]/).pop()

  const handleEditorChange = (newContent) => {
    console.info(`Editor content changed: ${selectedScript} ${newContent}`)
    sendTo(fullname, "saveScript", selectedScript, newContent)
  }

  return (
    <>
      <Box display="flex" height="100%">
        {/* Collapsible File Browser */}
        <Box width={expanded ? "15%" : "0%"} display="flex" flexDirection="column">
          <Box display="flex" alignItems="center" padding={1}>
            <IconButton onClick={toggleFileBrowser}>{expanded ? <ChevronLeft /> : <ChevronRight />}</IconButton>
            <Tooltip title="Save">
              <IconButton onClick={() => handleSaveScript(selectedScript)}>
                <Save />
              </IconButton>
            </Tooltip>
            <Tooltip title="Run">
              <IconButton onClick={() => sendTo(fullname, "runScript", selectedScript)}>
                <PlayArrow />
              </IconButton>
            </Tooltip>
            <Tooltip title="Delete">
              <IconButton onClick={() => sendTo(fullname, "deleteScript", selectedScript)}>
                <Delete />
              </IconButton>
            </Tooltip>
          </Box>
          {expanded && renderFileTree(fileTree || [])}
        </Box>

        {/* Main Editor Section */}
        <Box width={expanded ? "85%" : "100%"} display="flex" flexDirection="column" flexGrow={1}>
          {/* Toolbar and Tabs Section */}
          <Box display="flex" flexDirection="column">
            {/* Toolbar */}
            <Box display="flex" alignItems="center" padding={1}>
              &nbsp;
            </Box>
            {/* Tabs */}
            {openScripts && Object.keys(openScripts).length > 0 && (
              <Tabs value={selectedScript || Object.keys(openScripts)[0]} onChange={handleTabChange}>
                {Object.keys(openScripts).map((filePath) => {
                  const fileName = getFileName(filePath) // Extract the file name cross-platform
                  return (
                    <Tab
                      key={filePath}
                      label={
                        <Box display="flex" alignItems="center">
                          {fileName}
                          <IconButton
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation() // Prevent tab switching on close
                              handleCloseScript(filePath) // Notify server and close tab
                            }}
                          >
                            <Close fontSize="small" />
                          </IconButton>
                        </Box>
                      }
                      value={filePath}
                      sx={{
                        textTransform: "none" // Prevent uppercase transformation
                      }}
                    />
                  )
                })}
              </Tabs>
            )}
          </Box>
          {/* Ace Editor for script content */}
          {selectedScript && openScripts[selectedScript]?.content && (
            <AceEditor
              mode="javascript"
              theme="monokai"
              value={openScripts[selectedScript]?.content || "// No content available"}
              onChange={handleEditorChange}
              name="script-editor"
              editorProps={{ $blockScrolling: true }}
              width="100%"
              height="100%"
              minLines={50} // Set a minimum of 50 lines
              maxLines={Infinity}
            />
          )}
          {/* Console Area */}
          <Box
            component="pre"
            bgcolor="#272822"
            color="#C2E4D7"
            overflow="auto"
            height="100%"
            padding={0}
            fontFamily="monospace"
          >
            {/* Replace with actual console content */}
            {publishConsole}
          </Box>
        </Box>
      </Box>
    </>
  )
}
