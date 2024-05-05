import * as React from "react"
import ReactJson from "react-json-view"
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
      Unknown - This type of service does not have a defined ui below is its data
      <ReactJson src={service} name="service" />
    </>
  )
}
