import { Box } from "@mui/material"
import React from "react"
import { useProcessedMessage } from "../hooks/useProcessedMessage"
import useServiceSubscription from "../store/useServiceSubscription"

// FIXME remove fullname with context provider
export default function RobotLabXUI({ fullname }) {
  console.debug(`RobotLabXUI ${fullname}`)
  const serviceMsg = useServiceSubscription(fullname)
  const service = useProcessedMessage(serviceMsg)

  return (
    <>
      <Box sx={{ maxWidth: { xs: "100%", sm: "80%", md: "80%" } }}></Box>
    </>
  )
}
