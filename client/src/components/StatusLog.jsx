import { Grid } from "@mui/material"
import React, { useEffect, useState } from "react"
import { useProcessedMessage } from "../hooks/useProcessedMessage"
import { useStore } from "../store/store"

const StatusLog = ({ fullname }) => {
  const { useMessage, sendTo } = useStore()

  // FIXME
  // probably should be in the "store"
  const [statusLog, setStatusLog] = useState([])

  const statusMsg = useMessage(fullname, "publishStatus")

  // FIXME - componentize a status list with a window and count - store related - because
  // it should be global - so that alert counts can be done in TopMenuBar
  const status = useProcessedMessage(statusMsg)

  useEffect(() => {
    if (status) {
      // Add the new message to the log
      console.log("new status msg:", status)
      setStatusLog((log) => [...log, status])
    } else {
      console.error("no status message")
    }
  }, [status])

  return (
    <Grid>
      <div>
        {statusLog.map((status, index) => {
          let style = {}
          if (status.level === "info") {
            style = { color: "green" }
          } else if (status.level === "warn") {
            style = { color: "orange" }
          } else if (status.level === "error") {
            style = { color: "red" }
          }

          return (
            <div key={index} style={{ display: "flex", alignItems: "baseline", fontFamily: "monospace" }}>
              <small style={{ ...style, marginRight: "0.5rem" }}>{status.level}</small>
              <pre
                style={{ margin: 0, whiteSpace: "pre-wrap", wordWrap: "break-word" }}
                dangerouslySetInnerHTML={{ __html: status.detail }}
              />
            </div>
          )
        })}
      </div>
    </Grid>
  )
}

export default StatusLog
