import WestIcon from "@mui/icons-material/West"
import { Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from "@mui/material"
import React from "react"

function RouteTable({ service, routeTableArray, handleHostClick }) {
  return (
    <TableContainer component={Paper} elevation={3}>
      <Table aria-label="route table">
        <TableHead>
          <TableRow>
            <TableCell>Remote ID</TableCell>
            <TableCell>Gateway ID</TableCell>
            <TableCell>Gateway</TableCell>
            <TableCell>Default</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {service && service.defaultRoute && (
            <TableRow key={0} onClick={() => handleHostClick(service.defaultRoute)} hover>
              <TableCell>
                {service.defaultRoute.remoteId} <WestIcon sx={{ marginRight: 1, marginLeft: 1, fontSize: 12 }} />
              </TableCell>
              <TableCell>
                {service.defaultRoute.gatewayId} <WestIcon sx={{ marginRight: 1, marginLeft: 1, fontSize: 12 }} />
              </TableCell>
              <TableCell>
                {service.defaultRoute.gateway} <WestIcon sx={{ marginRight: 1, marginLeft: 1, fontSize: 12 }} />
              </TableCell>
              <TableCell>
                <b>default</b>
              </TableCell>
            </TableRow>
          )}
          {routeTableArray.map((routeEntry, index) => (
            <TableRow key={index + 1} onClick={() => handleHostClick(routeEntry)} hover>
              <TableCell>
                {routeEntry.remoteId} <WestIcon sx={{ marginRight: 1, marginLeft: 1, fontSize: 12 }} />
              </TableCell>
              <TableCell>
                {routeEntry.gatewayId} <WestIcon sx={{ marginRight: 1, marginLeft: 1, fontSize: 12 }} />
              </TableCell>
              <TableCell>
                {routeEntry.gateway} <WestIcon sx={{ marginRight: 1, marginLeft: 1, fontSize: 12 }} />
              </TableCell>
              <TableCell></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}

export default RouteTable
