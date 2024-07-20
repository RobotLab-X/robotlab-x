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

// Dynamically import Ace mode and theme
const loadAceMode = () => import("ace-builds/src-noconflict/mode-yaml")
const loadAceTheme = () => import("ace-builds/src-noconflict/theme-github")
const loadAceExtLanguageTools = () => import("ace-builds/src-noconflict/ext-language_tools")

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
    if (selectedFile && service?.config?.autoLaunch === selectedFile) {
      setAutolaunch(true)
    } else {
      setAutolaunch(false)
    }
  }, [selectedFile, service])

  useEffect(() => {
    loadAceMode()
    loadAceTheme()
    loadAceExtLanguageTools()
  }, [])

  const handleListItemClick = (file) => {
    setSelectedFile(file)
    sendTo(fullname, "getLaunchFile", file)
    setFileContent(launchFile)
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

  return (
    <>
      {JSON.stringify(launchFile)}
      <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
        <DialogTitle>Select Launch File</DialogTitle>
        <DialogContent>
          {editing ? (
            <AceEditor
              mode="yaml"
              theme="github"
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
              style={{ width: "100%", height: "400px" }}
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
          <Button onClick={onClose}>Cancel</Button>
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
    </>
  )
}
