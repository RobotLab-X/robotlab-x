import { Typography } from "@mui/material"
import * as React from "react"
import { useStore } from "../store/store"

// Props should put in "name"
// and all service types defined here
// the consumer of this and other "views" of components need to be responsible
// to make a layout that has the appropriat "typed" component and injected prop name

export default function Unknown({ name, fullname, id }) {
  console.info(`Unknown ${fullname}`)

  let registry = useStore((state) => state.registry)
  let service = registry[fullname]

  return (
    <>
      <Typography variant="h3" component="div">
        Node {service?.id} could not find requested service type {service?.requestTypeKey} in the local repository.
      </Typography>
      <Typography variant="h6" component="div">
        A minimal service definition was created for this service and will provide routing and network services.
      </Typography>
    </>
  )
}
