import Slider from "@mui/material/Slider"
import * as React from "react"

// Props should put in "name"
// and all service types defined here
// the consumer of this and other "views" of components need to be responsible
// to make a layout that has the appropriat "typed" component and injected prop name

export default function TestNodeService(props) {
  console.info("TestNodeService", props)
  return (
    <>
      <Slider defaultValue={70} aria-label="Small" valueLabelDisplay="auto" track={false} />
      <Slider defaultValue={50} aria-label="Default" valueLabelDisplay="auto" />
    </>
  )
}
