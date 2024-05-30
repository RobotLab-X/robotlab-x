import { Grid } from "@mui/material"
import React from "react"

const InstallLog = ({ messageLog }) => {
  return (
    <Grid container spacing={2} alignItems="flex-start">
      <Grid item xs={12} sm={12} md={8} lg={6}>
        <div style={{ wordWrap: "break-word", whiteSpace: "pre-wrap" }}>
          {messageLog.map((msg, index) => {
            // Extract the prefix and the rest of the message
            const prefixPattern = /^(info:|warn:|error:)/
            const matches = msg?.match(prefixPattern)
            let prefix = ""
            let message = msg

            if (matches) {
              prefix = matches[0] // The matched prefix
              message = msg.substring(prefix.length) // The rest of the message
            }

            let style = {}
            if (prefix === "info:") {
              style = { color: "green" }
            } else if (prefix === "warn:") {
              style = { color: "orange" }
            } else if (prefix === "error:") {
              style = { color: "red" }
            }

            return (
              <div key={index} style={{ display: "flex", alignItems: "baseline", fontFamily: "monospace" }}>
                <small style={{ ...style, marginRight: "0.5rem" }}>{prefix}</small>
                <pre
                  style={{ margin: 0, whiteSpace: "pre-wrap", wordWrap: "break-word" }}
                  dangerouslySetInnerHTML={{ __html: message }}
                />
              </div>
            )
          })}
        </div>
      </Grid>
    </Grid>
  )
}

export default InstallLog
