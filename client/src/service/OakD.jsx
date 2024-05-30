import { Button } from "@mui/material"
import InstallLog from "components/InstallLog"
import React, { useEffect, useState } from "react"
import StepWizard from "react-step-wizard"
import { useProcessedMessage } from "../hooks/useProcessedMessage"
import { useStore } from "../store/store"
import useServiceSubscription from "../store/useServiceSubscription"

// FIXME remove fullname with context provider
export default function OakD({ fullname }) {
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
        <h2>Step 1</h2>
        <p>{text}</p>
        {error && <p style={{ color: "red" }}>{error}</p>}

        <InstallLog messageLog={messageLog} />
        {!service?.installer.isPythonInstalled && (
          <Button variant="contained" color="primary" onClick={checkPythonVersion}>
            Check
          </Button>
        )}

        {service?.installer.isInstalledPythonVersionValid && (
          <Button variant="contained" color="primary" onClick={nextStep}>
            Next
          </Button>
        )}
      </div>
    )
  }

  const Step2 = ({ previousStep, nextStep, text = "Pip >= 19.0" }) => (
    <div>
      <h2>Step 2</h2>
      <p>{text}</p>

      <InstallLog messageLog={messageLog} />
      {!service?.installer.isPipInstalled && (
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

  const Step3 = ({ previousStep, nextStep, text = "Would you like to use a Python virtual environment?" }) => (
    <div>
      <h2>Step 3</h2>
      <p>{text}</p>
      <Button variant="contained" color="secondary" onClick={previousStep}>
        Previous
      </Button>
      <Button variant="contained" color="primary" onClick={nextStep}>
        Next
      </Button>
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
      <h1>OakD Camera Setup</h1>
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
