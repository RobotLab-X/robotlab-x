import { Table, TableBody, TableCell, TableRow } from "@mui/material"
import React from "react"
function ServiceComponent({ service }) {
  return (
    <Table>
      <TableBody>
        <TableRow>
          <TableCell>Name</TableCell>
          <TableCell>{service?.name}</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>Id</TableCell>
          <TableCell>{service?.id}</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>Type Key</TableCell>
          <TableCell>{service?.typeKey}</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>Version</TableCell>
          <TableCell>{service?.version}</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  )
}

export default ServiceComponent
