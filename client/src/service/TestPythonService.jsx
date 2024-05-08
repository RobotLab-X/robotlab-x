import { Grid } from "@mui/material"
import React, { useEffect, useState } from "react"
import Terminal, { ColorMode, TerminalOutput } from "react-terminal-ui"
import { useProcessedMessage } from "../hooks/useProcessedMessage"
import { useStore } from "../store/store"
import useServiceSubscription from "../store/useServiceSubscription"

// Props should put in "name"
// and all service types defined here
// the consumer of this and other "views" of components need to be responsible
// to make a layout that has the appropriat "typed" component and injected prop name

export default function TestPythonService({ name, fullname, id }) {
  console.info(`TestNodeService ${fullname}`)
  const { useMessage, sendTo } = useStore()
  const [stdOutLog, setStdOutLog] = useState([])

  // makes reference to the message object in store
  const stdOutMsg = useMessage(fullname, "publishStdOut")

  // creates subscriptions to topics and returns the broadcastState message reference
  const serviceMsg = useServiceSubscription(fullname, ["publishStdOut"])

  // processes the msg.data[0] and returns the data
  const service = useProcessedMessage(serviceMsg)
  const stdout = useProcessedMessage(stdOutMsg)

  const [terminalLineData, setTerminalLineData] = useState([<TerminalOutput></TerminalOutput>])

  useEffect(() => {
    if (stdout) {
      // Add the new message to the log
      // setStdOutLog((log) => [...(log.length >= 50 ? log.slice(1) : log), stdout])
      setTerminalLineData((log) => [...(log.length >= 50 ? log.slice(1) : log), stdout])
    }
  }, [stdout]) // Dependency array includes message, so this runs only if message changes

  return (
    <>
      <Grid container spacing={2} alignItems="flex-start">
        <Grid item xs={12} sm={8} md={6} lg={4}>
          <div className="container">
            <Terminal
              name=""
              colorMode={ColorMode.Dark}
              onInput={(terminalInput) => console.log(`New terminal input received: '${terminalInput}'`)}
            >
              <pre>{terminalLineData}</pre>
            </Terminal>
          </div>
          {/*}
          Message Log:
          <div>
            {stdOutLog.map((msg, index) => {
              return (
                <div key={index} style={{ display: "flex", alignItems: "baseline", fontFamily: "monospace" }}>
                  <pre style={{ margin: 0 }}>{msg}</pre>
                </div>
              )
            })}
          </div>
          */}
        </Grid>
      </Grid>
    </>
  )
}
