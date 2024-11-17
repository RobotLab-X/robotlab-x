import { Box, Typography } from "@mui/material"
import React from "react"
import useSubscription from "store/useSubscription"

// FIXME remove fullname with context provider
export default function RobotLabXUI({ fullname }) {
  console.debug(`RobotLabXUI ${fullname}`)
  const service = useSubscription(fullname, "broadcastState", true)

  return (
    <>
      {service && (
        <Box sx={{ maxWidth: { xs: "100%", sm: "80%", md: "80%" }, mt: 2 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            HERE ! {service?.name}
          </Typography>
          <Typography variant="body1" sx={{ mb: 2 }}>
            {service?.pkg?.description}
          </Typography>
          <Typography variant="body1" sx={{ mb: 2 }}>
            {service?.pkg?.version}
          </Typography>
        </Box>
      )}
      <Box sx={{ maxWidth: { xs: "100%", sm: "80%", md: "80%" } }}></Box>
    </>
  )
}
