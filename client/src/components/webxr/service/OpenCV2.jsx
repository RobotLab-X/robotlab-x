import React, { useRef, useEffect, useLayoutEffect, useContext, useState, useMemo, Suspense } from "react"
import { Pane, Plane, useFBO, OrthographicCamera, Box, Text, Html, Image } from "@react-three/drei"
// FIXME : use @store/store
import { useStore } from "../../../store/store"

export default function OpenCV2(props) {
  const msg = useStore((state) => state.messages["i01.opencv@vertx-vertx.onWebDisplay"])
  const [imageData, setImageData] = useState(null)
  console.log("OpenCV2 name", props.name)

  useLayoutEffect(() => {
    console.log("OpenCV2 useLayoutEffect")
    let img = msg?.data[0]?.data
    if (img) {
      setImageData(img)
    }
  }, [msg])

  if (imageData) {
    return (
      <>
        {/* <Image position={[0, 0.0, -5]} scale={[3.9, 3, 0.25]} url={imageData} /> */}
        {/*<Image position={[0, 0.0, -5]} scale={[3.9, 3, 1]} url={imageData} /> */}
        <Image url={imageData} />
      </>
    )
  }
}
