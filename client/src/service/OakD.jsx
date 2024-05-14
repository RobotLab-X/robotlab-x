// OakD.jsx
import { Button } from "@mui/material"
import StepWizard from "react-step-wizard"
import { useProcessedMessage } from "../hooks/useProcessedMessage"
import { useStore } from "../store/store"
import useServiceSubscription from "../store/useServiceSubscription"

// FIXME remove fullname with context provider
export default function OakD({ fullname }) {
  const { useMessage, sendTo } = useStore()

  // makes reference to the message object in store
  const epochMsg = useMessage(fullname, "publishEpoch")

  // creates subscriptions to topics and returns the broadcastState message reference
  const serviceMsg = useServiceSubscription(fullname, ["publishEpoch"])

  // processes the msg.data[0] and returns the data
  const service = useProcessedMessage(serviceMsg)
  const timestamp = useProcessedMessage(epochMsg)

  const Step1 = ({ nextStep, text = "Checking for Python..." }) => (
    <div>
      <h2>Step 1</h2>
      <p>{text}</p>
      <Button variant="contained" color="primary" onClick={nextStep}>
        Next
      </Button>
    </div>
  )

  const Step2 = ({ previousStep, nextStep, text = "Would you like to use a Python virtual environment?" }) => (
    <div>
      <h2>Step 2</h2>
      <p>{text}</p>
      <Button variant="contained" color="secondary" onClick={previousStep}>
        Previous
      </Button>
      <Button variant="contained" color="primary" onClick={nextStep}>
        Next
      </Button>
    </div>
  )

  const Step3 = ({ previousStep, nextStep, text = "Git Clone the DepthAI SDK" }) => (
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

  const Step4 = ({ previousStep, text = "Success, you should be ready to start the camera" }) => (
    <div>
      <h2>Step 4</h2>
      <p>{text}</p>
    </div>
  )

  const handleStart = () => {
    sendTo(fullname, "startClock")
  }

  const handleStop = () => {
    sendTo(fullname, "stopClock")
  }

  return (
    <>
      <h1>Let's Setup the OakD Camera</h1>
      <StepWizard>
        <Step1 />
        <Step2 />
        <Step3 />
        <Step4 />
      </StepWizard>
    </>
  )
}
