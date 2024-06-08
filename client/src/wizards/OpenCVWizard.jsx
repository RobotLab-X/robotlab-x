import { Button, FormControl, FormControlLabel, Radio, RadioGroup } from "@mui/material"
import InstallLog from "components/InstallLog"
import React, { useEffect, useState } from "react"
import StepWizard from "react-step-wizard"
import { useProcessedMessage } from "../hooks/useProcessedMessage"
import { useStore } from "../store/store"
import useServiceSubscription from "../store/useServiceSubscription"

// FIXME remove fullname with context provider
export default function OpenCVWizard({ fullname }) {
  const { useMessage, sendTo } = useStore()

  // makes reference to the message object in store
  const installLogMsg = useMessage(fullname, "publishInstallLog")

  // creates subscriptions to topics and returns the broadcastState message reference
  const serviceMsg = useServiceSubscription(fullname, ["publishInstallLog"])

  // processes the msg.data[0] and returns the data
  const service = useProcessedMessage(serviceMsg)
  const installLog = useProcessedMessage(installLogMsg)
  const [messageLog, setMessageLog] = useState([])
  const [error, setError] = useState(null)

  const [selection, setSelection] = useState("")

  const handleSelectionChange = (event) => {
    setSelection(event.target.value)
  }

  const handleInstallVenv = () => {
    // Handler logic for installing venv
    console.log("Install venv button clicked")
  }

  useEffect(() => {
    if (installLog) {
      // Add the new message to the log
      console.log("new install log msg:", installLog)
      setMessageLog((log) => [...log, installLog])
    }
  }, [installLog])

  const Step1 = ({ nextStep, text = "Python >=3.6.0 required" }) => {
    return (
      <div>
        <h2>Step 1 Check for Python</h2>
        <p>{text}</p>
        {error && <p style={{ color: "red" }}>{error}</p>}

        <InstallLog messageLog={messageLog} />
        {!service?.installer?.isPythonInstalled && (
          <Button variant="contained" color="primary" onClick={checkPythonVersion}>
            Check
          </Button>
        )}

        {service?.installer?.isInstalledPythonVersionValid && (
          <Button variant="contained" color="primary" onClick={nextStep}>
            Next
          </Button>
        )}
      </div>
    )
  }

  const Step2 = ({ previousStep, nextStep, text = "Pip >= 19.0" }) => (
    <div>
      <h2>Step 2 Check for Pip</h2>
      <p>{text}</p>

      <InstallLog messageLog={messageLog} />
      {!service?.installer?.isPipInstalled && (
        <Button variant="contained" color="primary" onClick={checkPipVersion}>
          Check
        </Button>
      )}

      <Button variant="contained" color="secondary" onClick={previousStep}>
        Previous
      </Button>
      <Button variant="contained" color="primary" onClick={nextStep}>
        Next
      </Button>
    </div>
  )

  const Step3 = ({ previousStep, nextStep, text = "" }) => (
    <div>
      <h2>Step 3 Virtual Environment</h2>
      <p>{text}</p>
      <FormControl component="fieldset">
        <RadioGroup aria-label="venv" name="venv" value={selection} onChange={handleSelectionChange}>
          <FormControlLabel value="useVenv" control={<Radio />} label="Virtual env (recommended)" />
          <FormControlLabel value="noVenv" control={<Radio />} label="Do not use venv" />
        </RadioGroup>
      </FormControl>
      <Button variant="contained" color="secondary" onClick={previousStep}>
        Previous
      </Button>
      {selection === "noVenv" && (
        <Button variant="contained" color="primary" onClick={nextStep}>
          Next
        </Button>
      )}
      {selection === "useVenv" && (
        <Button variant="contained" color="primary" onClick={handleInstallVenv}>
          Install Virtual Env
        </Button>
      )}
    </div>
  )

  const Step4 = ({ previousStep, nextStep, text = "Git Clone the DepthAI SDK" }) => (
    <div>
      <h2>Step 4</h2>
      <p>{text}</p>
      <Button variant="contained" color="secondary" onClick={previousStep}>
        Previous
      </Button>
      <Button variant="contained" color="primary" onClick={nextStep}>
        Next
      </Button>
    </div>
  )

  const Step5 = ({ previousStep, text = "Success, you should be ready to start the camera" }) => (
    <div>
      <h2>Step 5</h2>
      <p>{text}</p>
    </div>
  )

  const checkPythonVersion = () => {
    sendTo(fullname, "checkPythonVersion")
  }

  const checkPipVersion = () => {
    sendTo(fullname, "checkPipVersion")
  }

  return (
    <>
      <h1>OpenCV Setup</h1>
      <StepWizard>
        <Step1 />
        <Step2 />
        <Step3 />
        <Step4 />
        <Step5 />
      </StepWizard>
    </>
  )
}
