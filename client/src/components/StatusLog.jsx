import { Grid } from "@mui/material"
import React from "react"

const StatusLog = ({ statusLog }) => {
  return (
    <Grid container>
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
              <span
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
