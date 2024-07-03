import { Card, CardContent, Grid, Typography } from "@mui/material"
import React from "react"

const ProcessesPanel = ({ processArray, imagesUrl }) => {
  return (
    <Grid container justifyContent="left">
      <Grid item xs={12} sm={8} md={6} lg={4}>
        Detailed view for Processes
        {processArray.map((pd, index) => (
          <Card key={index} onClick={() => console.log(pd)} sx={{ margin: 1 }}>
            <CardContent>
              <Typography variant="h5" component="div">
                <img src={`${imagesUrl}/platform/${pd?.platform}.png`} alt={pd?.platform} width="16" />{" "}
                {/* <img src={`${imagesUrl}/os/${pd.platform}.png`} alt={pd.typeKey} width="16" /> */}
                &nbsp;{pd.id}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                pid {pd.pid}
                <br />
                platform {pd.platform} {pd.platformVersion}
                <br />
                hostname {pd.hostname}
              </Typography>
            </CardContent>
          </Card>
        ))}
      </Grid>
    </Grid>
  )
}

export default ProcessesPanel
