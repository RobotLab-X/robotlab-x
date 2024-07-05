import { Typography } from "@mui/material"
import * as React from "react"
import { useRegisteredService, useStore } from "../store/store"

// Props should put in "name"
// and all service types defined here
// the consumer of this and other "views" of components need to be responsible
// to make a layout that has the appropriat "typed" component and injected prop name

export default function Unknown({ name, fullname, id }) {
  console.debug(`Unknown ${fullname}`)

  let registry = useStore((state) => state.registry)
  let service = registry[fullname]
  const registered = useRegisteredService(fullname)

  return (
    <>
      <br />
      <br />
      <Typography variant="h3" component="div">
        No UI currently defined for type {registered?.typeKey}.
      </Typography>
    </>
  )
}
