import React from "react"
import { Text } from "@react-three/drei"

export function PoseText(props) {
  const controllerData = props.controllerData
  const poseName = props.poseName
  const precision = props.precision

  if (controllerData[poseName]) {
    let p = controllerData[poseName].position
    let r = controllerData[poseName].orientation
    return (
      <Text {...props}>
        {poseName}
        {"\n"}position: {p.x.toFixed(precision)}, {p.y.toFixed(precision)},{p.z.toFixed(precision)}
        {"\n"}
        orientation: {r.pitch.toFixed(precision)},{r.roll.toFixed(precision)},{r.yaw.toFixed(precision)}
        {"\n"}
      </Text>
    )
  }
}
