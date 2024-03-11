import React, { useEffect, useState, useRef } from "react"
import { Text, View } from "@react-three/drei"

export function FrameRate(props) {
  const [framerate, setFramerate] = useState(0)
  const lastTime = useRef(0)

  useEffect(() => {
    animate()
  }, [])

  function animate() {
    requestAnimationFrame(() => {
      const currentTime = Date.now()
      const elapsed = currentTime - lastTime.current
      const framerate = Math.round(1000 / elapsed)
      setFramerate(framerate)
      lastTime.current = currentTime
      animate()
    })
  }

  return <Text style={{ color: "white", fontSize: 30 }}>{framerate} fps</Text>
}

export default FrameRate
