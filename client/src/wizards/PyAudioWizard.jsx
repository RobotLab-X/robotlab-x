import { Button } from "@mui/material"
import React, { useState } from "react"
import StepWizard from "react-step-wizard"
import { useProcessedMessage } from "../hooks/useProcessedMessage"
import { useStore } from "../store/store"
import useServiceSubscription from "../store/useServiceSubscription"

// FIXME remove fullname with context provider
export default function PyAudioWizard({ fullname }) {
  const { sendTo } = useStore()

  // creates subscriptions to topics and returns the broadcastState message reference
  const serviceMsg = useServiceSubscription(fullname)
  const service = useProcessedMessage(serviceMsg)
  const [selection, setSelection] = useState("")
  const [isInstalling, setIsInstalling] = useState(false)

  const checkPythonVersion = () => {
    sendTo(fullname, "checkPythonVersion")
  }

  const checkPipVersion = () => {
    sendTo(fullname, "checkPipVersion")
  }

  const handleVenvSelection = (event) => {
    setSelection(event.target.value)
  }

  const installVenv = () => {
    setIsInstalling(true)
    sendTo(fullname, "installVirtualEnv")
  }

  const installPyAudio = () => {
    setIsInstalling(true)
    sendTo(fullname, "installPipRequirements", service?.pkg?.requirements)
  }

  const startProxy = () => {
    sendTo(fullname, "startProxy")
  }

  const installRepoRequirements = () => {
    setIsInstalling(true)
    // sendTo(fullname, "installClient")
    sendTo(fullname, "installRepoRequirements")
  }

  const finished = () => {
    sendTo(fullname, "setInstalled", true)
    sendTo(fullname, "broadcastState")
  }

  const CheckPythonVersion = ({ nextStep }) => {
    return (
      <div>
        <h2>Step 1 Check for Python</h2>
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

  const CheckPipVersion = ({ previousStep, nextStep }) => (
    <div>
      <h2>Step 2 Check for Pip</h2>
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

  const InstallVenv = ({ previousStep, nextStep }) => {
    const handleNextStep = () => {
      setIsInstalling(false)
      nextStep()
    }

    return (
      <div>
        <h2>Step 3 Virtual Environment</h2>
        {/* <FormControl component="fieldset">
          <RadioGroup aria-label=".venv" name=".venv" value={selection} onChange={handleVenvSelection}>
            <FormControlLabel value="useVenv" control={<Radio />} label="Virtual env (recommended)" />
            <FormControlLabel value="noVenv" control={<Radio />} label="Do not use .venv" />
          </RadioGroup>
        </FormControl> */}
        <div style={{ marginTop: "20px" }}>
          {service?.venvOk && (
            <Button variant="contained" color="primary" onClick={handleNextStep}>
              Next
            </Button>
          )}
          {!service?.venvOk && (
            <Button variant="contained" color="primary" onClick={installVenv} disabled={isInstalling}>
              {isInstalling ? "Installing..." : "Install Virtual Env"}
            </Button>
          )}
        </div>
      </div>
    )
  }

  const InstallPyAudio = ({ previousStep, nextStep }) => {
    const handleNextStep = () => {
      setIsInstalling(false)
      nextStep()
    }

    return (
      <div>
        <h2>Step 4 Install PyAudio</h2>
        {service?.pythonVersionOk && service?.pipVersionOk && !service?.requirementsOk && (
          <Button variant="contained" color="primary" onClick={installPyAudio} disabled={isInstalling}>
            {isInstalling ? "Installing..." : "Install"}
          </Button>
        )}
        {service?.requirementsOk && (
          <Button variant="contained" color="primary" onClick={handleNextStep}>
            Next
          </Button>
        )}
      </div>
    )
  }

  const InstallRepoRequirements = ({ previousStep, nextStep }) => (
    <div>
      <h2>Step 5 Install RobotLab-X Client</h2>
      {service?.pythonVersionOk && service?.pipVersionOk && service?.requirementsOk && !service?.clientInstalledOk && (
        <Button variant="contained" color="primary" onClick={installRepoRequirements} disabled={isInstalling}>
          {isInstalling ? "Installing..." : "Install"}
        </Button>
      )}
      {service?.clientInstalledOk && (
        <Button variant="contained" color="primary" onClick={nextStep}>
          Next
        </Button>
      )}
    </div>
  )

  const StartProxy = ({ previousStep, nextStep }) => (
    <div>
      <h2>Step 6 Start RobotLab-X Client</h2>
      {service?.pythonVersionOk && service?.pipVersionOk && service?.requirementsOk && !service?.clientConnected && (
        <Button variant="contained" color="primary" onClick={startProxy}>
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

  const Finished = ({ previousStep, nextStep, text = "Git Clone the DepthAI SDK" }) => (
    <div>
      <h2>Finished</h2>
      <p>You should be able to use the PyAudio service now</p>
      <Button variant="contained" color="primary" onClick={finished}>
        Finish
      </Button>
    </div>
  )

  return (
    <>
      <h1>PyAudio Setup</h1>
      <StepWizard>
        <CheckPythonVersion />
        <CheckPipVersion />
        <InstallVenv />
        <InstallPyAudio />
        <InstallRepoRequirements />
        <StartProxy />
        <Finished />
      </StepWizard>
    </>
  )
}
