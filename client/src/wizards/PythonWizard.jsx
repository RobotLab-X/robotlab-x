import { Button, CircularProgress } from "@mui/material"
import React, { useState } from "react"
import StepWizard from "react-step-wizard"
import { useProcessedMessage } from "../hooks/useProcessedMessage"
import { useStore } from "../store/store"
import useServiceSubscription from "../store/useServiceSubscription"

export default function PythonWizard({ fullname }) {
  const { sendTo } = useStore()

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

  const installPipRequirements = () => {
    setIsInstalling(true)
    sendTo(fullname, "installPipRequirements", service?.pkg?.requirements)
  }

  const startProxy = () => {
    sendTo(fullname, "startProxy")
  }

  const installRepoRequirements = () => {
    setIsInstalling(true)
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
        <div style={{ marginTop: "20px" }}>
          {service?.venvOk && (
            <Button variant="contained" color="primary" onClick={handleNextStep}>
              Next
            </Button>
          )}
          {!service?.venvOk && (
            <Button variant="contained" color="primary" onClick={installVenv} disabled={isInstalling}>
              {isInstalling ? <CircularProgress size={24} /> : "Install Virtual Env"}
            </Button>
          )}
        </div>
      </div>
    )
  }

  const InstallPipRequirements = ({ previousStep, nextStep }) => {
    const handleNextStep = () => {
      setIsInstalling(false)
      nextStep()
    }

    return (
      <div>
        <h2>Step 4 Install {service?.pkg?.title}</h2>
        {service?.pythonVersionOk && service?.pipVersionOk && !service?.requirementsOk && (
          <Button variant="contained" color="primary" onClick={installPipRequirements} disabled={isInstalling}>
            {isInstalling ? <CircularProgress size={24} /> : "Install"}
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
      <h2>Step 5 Install Local Packages and RobotLab-X Client</h2>
      {service?.pythonVersionOk && service?.pipVersionOk && service?.requirementsOk && !service?.clientInstalledOk && (
        <Button variant="contained" color="primary" onClick={installRepoRequirements} disabled={isInstalling}>
          {isInstalling ? <CircularProgress size={24} /> : "Install"}
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
      <p>You should be able to use the {service?.pkg?.title} </p>
      <Button variant="contained" color="primary" onClick={finished}>
        Finish
      </Button>
    </div>
  )

  return (
    <>
      <h1>{service?.pkg?.title} Setup</h1>
      <StepWizard>
        <CheckPythonVersion />
        <CheckPipVersion />
        <InstallVenv />
        <InstallPipRequirements />
        <InstallRepoRequirements />
        <StartProxy />
        <Finished />
      </StepWizard>
    </>
  )
}
