import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  List,
  ListItem,
  ListItemText,
  Tooltip
} from "@mui/material"
import React, { useEffect, useState } from "react"
import AceEditor from "react-ace"
import { useStore } from "store/store"

// Import Ace build files
import "ace-builds/src-noconflict/ace"
import "ace-builds/src-noconflict/ext-language_tools"
import "ace-builds/src-noconflict/mode-javascript"
import "ace-builds/src-noconflict/theme-monokai"

export default function StartLaunchFileDialog({
  fullname,
  open,
  onClose,
  launchFiles,
  isExampleFile,
  onLaunchFileSelect
}) {
  const getApiUrl = useStore((state) => state.getApiUrl)
  const [selectedFile, setSelectedFile] = useState(null)
  const [autolaunch, setAutolaunch] = useState(false)
  const [editing, setEditing] = useState(false)
  const [fileContent, setFileContent] = useState("")

  // TODO !!! - make this get("saveLaunchFile", filename, content) or put/post("saveLaunchFile", filename, content)
  useEffect(() => {
    if (selectedFile) {
      const filename = isExampleFile ? `examples%2F${selectedFile}` : selectedFile
      const url = `${getApiUrl()}/${fullname}/getLaunchFile/"${filename}"`
      console.log("Fetching file content from URL:", url)
      fetch(url)
        .then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`)
          }
          return response.json()
        })
        .then((data) => {
          console.log("File content fetched successfully:", data)
          setFileContent(data)
        })
        .catch((error) => console.error("Error fetching file content:", error))
    }
  }, [selectedFile, isExampleFile, getApiUrl, fullname])

  useEffect(() => {
    console.log("fileContent state updated:", fileContent)
  }, [fileContent])

  const handleEdit = () => {
    if (selectedFile) {
      setEditing(true)
    }
  }

  const handleLaunch = () => {
    if (selectedFile) {
      onLaunchFileSelect(selectedFile, autolaunch)
    }
  }

  const handleSave = () => {
    console.log("Saving content for file:", selectedFile)
    console.log("Content:", fileContent)
    const url = `${getApiUrl()}/${fullname}/saveLaunchFile`
    console.log("Saving file content to URL:", url)
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify([selectedFile, fileContent])
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }
        return response.json()
      })
      .then((data) => {
        console.log("File saved successfully:", data)
      })
      .catch((error) => console.error("Error saving file:", error))
    setEditing(false)
  }

  const handleCancel = () => {
    setEditing(false)
    onClose()
  }

  const handleFileClick = (file) => {
    setSelectedFile(file)
  }

  return (
    <Dialog open={open} onClose={handleCancel} maxWidth={editing ? "xl" : "md"} fullWidth>
      <DialogTitle>{selectedFile ? `${selectedFile}` : "Select Launch File"}</DialogTitle>
      <DialogContent style={editing ? { height: "80vh", padding: 0 } : {}}>
        {editing ? (
          <AceEditor
            key={selectedFile} // Add key prop to force re-render
            mode="javascript"
            theme="monokai"
            name="ace-editor"
            value={fileContent}
            onChange={(newValue) => {
              console.log("Ace Editor content change:", newValue)
              setFileContent(newValue)
            }}
            editorProps={{ $blockScrolling: true }}
            setOptions={{
              useWorker: false,
              enableBasicAutocompletion: true,
              enableLiveAutocompletion: true,
              enableSnippets: true
            }}
            style={{ width: "100%", height: "100%" }}
          />
        ) : (
          <>
            <List>
              {launchFiles &&
                launchFiles.map((file, index) => (
                  <ListItem button key={index} selected={selectedFile === file} onClick={() => handleFileClick(file)}>
                    <ListItemText primary={file} />
                  </ListItem>
                ))}
            </List>
            {selectedFile && (
              <Tooltip title="Autolaunch this file when RobotLab-X starts">
                <FormControlLabel
                  control={<Checkbox checked={autolaunch} onChange={(e) => setAutolaunch(e.target.checked)} />}
                  label="Autolaunch"
                />
              </Tooltip>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleCancel}>Cancel</Button>
        {editing ? (
          <>
            <Button onClick={handleSave} color="primary">
              Save As
            </Button>
            <Button onClick={handleSave} color="primary">
              Save
            </Button>
          </>
        ) : (
          <>
            <Button onClick={handleEdit} disabled={!selectedFile} color="primary">
              Edit
            </Button>
            <Button onClick={handleLaunch} disabled={!selectedFile} color="primary">
              Launch
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  )
}
