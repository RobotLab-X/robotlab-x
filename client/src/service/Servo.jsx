import * as React from "react"
import Slider from "@mui/material/Slider"

// Props should put in "name"
// and all service types defined here
// the consumer of this and other "views" of components need to be responsible
// to make a layout that has the appropriat "typed" component and injected prop name

export default function Servo(props) {
  console.info("Servo", props)
  return (
    <>
      <Slider defaultValue={70} aria-label="Small" valueLabelDisplay="auto" track={false} />
      <Slider defaultValue={50} aria-label="Default" valueLabelDisplay="auto" />
    </>
  )
}
