import { East, West } from "@mui/icons-material"
import { Box, Card, CardActionArea, CardContent, Grid, Typography } from "@mui/material"
import RouteTable from "components/RouteTable"
import React from "react"
import ReactJson from "react-json-view"

const ConnectionsPanel = ({ connectionArray, service, handleHostClick, routeTableArray, debug }) => {
  return (
    <Grid container justifyContent="flex-start">
      <Grid item>
        <Box display="flex" flexDirection="column" alignItems="left">
          Connection details
          {connectionArray.map((connection, index) => (
            <Card key={index} onClick={() => handleHostClick(connection)} sx={{ margin: 1 }}>
              <CardActionArea>
                <CardContent>
                  <Box display="flex" alignItems="center" sx={{ marginBottom: 1 }}>
                    <Typography variant="h5" component="div">
                      {connection.gatewayId}
                    </Typography>
                    {connection.direction === "inbound" ? (
                      <East sx={{ marginRight: 1, marginLeft: 1 }} />
                    ) : (
                      <West sx={{ marginRight: 1, marginLeft: 1 }} />
                    )}
                    <Typography variant="h5" component="div">
                      {service.id}
                    </Typography>
                  </Box>
                  <Typography component="div" variant="body2" color="text.secondary">
                    <small>{connection.uuid}</small>
                  </Typography>
                </CardContent>
              </CardActionArea>
            </Card>
          ))}
          Route Table
          {service && service.defaultRoute && (
            <>
              <RouteTable service={service} routeTableArray={routeTableArray} handleHostClick={handleHostClick} />
            </>
          )}
          {debug && (
            <>
              <ReactJson
                src={service?.connections}
                name="connections"
                displayDataTypes={false}
                displayObjectSize={false}
              />
              <ReactJson
                src={service?.routeTable}
                name="routeTableArray"
                displayDataTypes={false}
                displayObjectSize={false}
              />
            </>
          )}
        </Box>
      </Grid>
    </Grid>
  )
}

export default ConnectionsPanel
