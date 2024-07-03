import { Grid } from "@mui/material"
import React from "react"

const MessageLog = ({ messageLog }) => {
  return (
    <Grid container spacing={2} alignItems="flex-start">
      <Grid item xs={12} sm={8} md={6} lg={4}>
        <div>
          {messageLog.map((msg, index) => {
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
              style = { color: "yellow" }
            } else if (prefix === "error:") {
              style = { color: "red" }
            }

            return (
              <div key={index} style={{ display: "flex", alignItems: "baseline", fontFamily: "monospace" }}>
                <small style={{ ...style, marginRight: "0.5rem" }}>{prefix}</small>
                <pre style={{ margin: 0 }}>{message}</pre>
              </div>
            )
          })}
        </div>
      </Grid>
    </Grid>
  )
}

export default MessageLog
