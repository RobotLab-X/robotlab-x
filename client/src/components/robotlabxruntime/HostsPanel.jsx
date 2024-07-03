import { Card, CardActionArea, CardContent, Grid, Typography } from "@mui/material"
import React from "react"

const HostsPanel = ({ hostArray, imagesUrl, handleHostClick }) => {
  return (
    <Grid container justifyContent="left">
      <Grid item xs={12} sm={8} md={6} lg={4}>
        Detailed view for Hosts
        {hostArray.map((host, index) => (
          <Card key={index} onClick={() => handleHostClick(host)} sx={{ margin: 1 }}>
            <CardActionArea>
              <CardContent>
                <Typography component="div" variant="h5">
                  <img src={`${imagesUrl}/os/${host.platform}.png`} alt={host.platform} width="16" />
                  &nbsp;&nbsp;{host.hostname}
                </Typography>
                <Typography component="div" variant="body2" color="text.secondary">
                  {host.platform} {host.architecture} cpus {host.numberOfCPUs} memory{" "}
                  {Math.round(host.totalMemory / 1073741824)} GB
                </Typography>
              </CardContent>
            </CardActionArea>
          </Card>
        ))}
      </Grid>
    </Grid>
  )
}

export default HostsPanel
