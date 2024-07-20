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
import { useProcessedMessage } from "../../hooks/useProcessedMessage"
import useServiceSubscription from "../../store/useServiceSubscription"

// Import Ace build files
import "ace-builds/src-noconflict/ace"
import "ace-builds/src-noconflict/ext-language_tools"
import "ace-builds/src-noconflict/mode-javascript"
import "ace-builds/src-noconflict/theme-github"
import "ace-builds/src-noconflict/theme-monokai"

export default function StartLaunchFileDialog({ fullname, open, onClose, launchFiles, onLaunchFileSelect }) {
  const { subscribeTo, unsubscribeFrom, useMessage, sendTo } = useStore()
  const [selectedFile, setSelectedFile] = useState(null)
  const [autolaunch, setAutolaunch] = useState(false)
  const [editing, setEditing] = useState(false)
  const [fileContent, setFileContent] = useState("")

  const serviceMsg = useServiceSubscription(fullname, ["getRepo", "getLaunchFiles", "getLaunchFile"])
  const service = useProcessedMessage(serviceMsg)
  const launchFileMsg = useMessage(fullname, "getLaunchFile")
  const launchFile = useProcessedMessage(launchFileMsg)

  useEffect(() => {
    if (selectedFile) {
      sendTo(fullname, "getLaunchFile", selectedFile)
    }
  }, [selectedFile, sendTo, fullname])

  useEffect(() => {
    if (launchFile) {
      setFileContent(launchFile)
    }
  }, [launchFile])

  useEffect(() => {
    if (selectedFile && service?.config?.autoLaunch === selectedFile) {
      setAutolaunch(true)
    } else {
      setAutolaunch(false)
    }
  }, [selectedFile, service])

  const handleListItemClick = (file) => {
    setSelectedFile(file)
  }

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
    // Save the edited content logic
    console.log("Saved content:", fileContent)
    setEditing(false)
  }

  const handleCancel = () => {
    setEditing(false)
    onClose()
  }

  return (
    <Dialog open={open} onClose={handleCancel} maxWidth={editing ? "xl" : "md"} fullWidth>
      <DialogTitle>Select Launch File</DialogTitle>
      <DialogContent style={editing ? { height: "80vh", padding: 0 } : {}}>
        {editing ? (
          <AceEditor
            mode="javascript"
            theme="monokai"
            name="ace-editor"
            value={fileContent}
            onChange={(newValue) => setFileContent(newValue)}
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
                  <ListItem
                    button
                    key={index}
                    selected={selectedFile === file}
                    onClick={() => handleListItemClick(file)}
                  >
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
          <Button onClick={handleSave} color="primary">
            Save
          </Button>
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
