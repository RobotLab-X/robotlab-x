import { Button, FormControl, FormControlLabel, Radio, RadioGroup } from "@mui/material"
import StatusLog from "components/StatusLog"
import React, { useState } from "react"
import StepWizard from "react-step-wizard"
import { useProcessedMessage } from "../hooks/useProcessedMessage"
import { useStore } from "../store/store"
import useServiceSubscription from "../store/useServiceSubscription"

// FIXME remove fullname with context provider
export default function OpenCVWizard({ fullname, statusLog }) {
  const { sendTo } = useStore()

  // creates subscriptions to topics and returns the broadcastState message reference
  const serviceMsg = useServiceSubscription(fullname)

  const service = useProcessedMessage(serviceMsg)
  const [selection, setSelection] = useState("")
  const [isInstalling, setIsInstalling] = useState(false)

  const handleSelectionChange = (event) => {
    setSelection(event.target.value)
  }

  const handleInstallVenv = () => {
    setIsInstalling(true)
    sendTo(fullname, "installVirtualEnv")
  }

  const installOpenCV = () => {
    setIsInstalling(true)
    sendTo(fullname, "installPipRequirements", service?.pkg?.requirements)
  }

  const startClient = () => {
    sendTo(fullname, "startClient")
  }

  const installClient = () => {
    sendTo(fullname, "installClient")
  }

  const handleFinished = () => {
    sendTo(fullname, "setInstalled", true)
    sendTo(fullname, "broadcastState")
  }

  const Step1 = ({ nextStep }) => {
    return (
      <div>
        <h2>Step 1 Check for Python</h2>
        <StatusLog statusLog={statusLog} />
        {!service?.pythonVersionOk && (
          <Button variant="contained" color="primary" onClick={checkPythonVersion}>
            Check
          </Button>
        )}

        {service?.pythonVersionOk && (
          <Button variant="contained" color="primary" onClick={nextStep}>
            Next
          </Button>
        )}
      </div>
    )
  }

  const Step2 = ({ previousStep, nextStep }) => (
    <div>
      <h2>Step 2 Check for Pip</h2>
      <StatusLog statusLog={statusLog} />
      {!service?.pipVersionOk && (
        <Button variant="contained" color="primary" onClick={checkPipVersion}>
          Check
        </Button>
      )}
      {service?.pipVersionOk && (
        <Button variant="contained" color="primary" onClick={nextStep}>
          Next
        </Button>
      )}
    </div>
  )

  const Step3 = ({ previousStep, nextStep }) => {
    const handleNextStep = () => {
      setIsInstalling(false)
      nextStep()
    }

    return (
      <div>
        <h2>Step 3 Virtual Environment</h2>
        <StatusLog statusLog={statusLog} />
        <FormControl component="fieldset">
          <RadioGroup aria-label="venv" name="venv" value={selection} onChange={handleSelectionChange}>
            <FormControlLabel value="useVenv" control={<Radio />} label="Virtual env (recommended)" />
            <FormControlLabel value="noVenv" control={<Radio />} label="Do not use venv" />
          </RadioGroup>
        </FormControl>
        <div style={{ marginTop: "20px" }}>
          {(selection === "noVenv" || service?.venvOk) && (
            <Button variant="contained" color="primary" onClick={handleNextStep}>
              Next
            </Button>
          )}
          {selection === "useVenv" && !service?.venvOk && (
            <Button variant="contained" color="primary" onClick={handleInstallVenv} disabled={isInstalling}>
              {isInstalling ? "Installing..." : "Install Virtual Env"}
            </Button>
          )}
        </div>
      </div>
    )
  }

  const Step4 = ({ previousStep, nextStep }) => (
    <div>
      <h2>Step 4 Install OpenCV</h2>
      <StatusLog statusLog={statusLog} />
      {service?.pythonVersionOk && service?.pipVersionOk && !service?.requirementsOk && (
        <Button variant="contained" color="primary" onClick={installOpenCV} disabled={isInstalling}>
          {isInstalling ? "Installing..." : "Install"}
        </Button>
      )}
      {service?.requirementsOk && (
        <Button variant="contained" color="primary" onClick={nextStep}>
          Next
        </Button>
      )}
    </div>
  )

  const InstallClient = ({ previousStep, nextStep }) => (
    <div>
      <h2>Step 5 Install RobotLab-X Client</h2>
      <StatusLog statusLog={statusLog} />
      {
        <Button variant="contained" color="primary" onClick={installClient}>
          Install
        </Button>
      }
      {service?.requirementsOk && (
        <Button variant="contained" color="primary" onClick={nextStep}>
          Next
        </Button>
      )}
    </div>
  )

  const StartOpenCVClient = ({ previousStep, nextStep }) => (
    <div>
      <h2>Step 6 Start RobotLab-X Client</h2>
      <StatusLog statusLog={statusLog} />
      {service?.pythonVersionOk && service?.pipVersionOk && service?.requirementsOk && (
        <Button variant="contained" color="primary" onClick={startClient}>
          Start
        </Button>
      )}
      {service?.clientConnected && (
        <Button variant="contained" color="primary" onClick={nextStep}>
          Next
        </Button>
      )}
    </div>
  )

  const StepFinished = ({ previousStep, nextStep, text = "Git Clone the DepthAI SDK" }) => (
    <div>
      <h2>Finished</h2>
      <p>You should be able to use the OpenCV service now</p>
      <Button variant="contained" color="primary" onClick={handleFinished}>
        Finish
      </Button>
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
        <InstallClient />
        <StartOpenCVClient />
        <StepFinished />
      </StepWizard>
    </>
  )
}
