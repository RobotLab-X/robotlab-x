import React, { useRef, useEffect, useContext, useState, useMemo, Suspense } from "react"
import { useFrame, createPortal, useThree, Canvas } from "@react-three/fiber"
import { useXR } from "@react-three/xr"
import { VRButton, ARButton, XR, Controllers, Hands, useXREvent, useController } from "@react-three/xr"
import { Pane, Plane, useFBO, OrthographicCamera, Box, Text, Html, Image } from "@react-three/drei"
import { VideoTexture, UniformsUtils } from "three"
import CurvedPlane from "./_CurvedPlane"
import { useVideoTexture, Center } from "@react-three/drei"
import * as THREE from "three"

const { DEG2RAD } = THREE.MathUtils

export default function Screen({ src }) {
  const [video, setVideo] = useState()

  const ratio = 16 / 9
  const width = 5
  const radius = 4
  const z = 4

  const r = useMemo(() => (video ? video.videoWidth / video.videoHeight : ratio), [video, ratio])

  return (
    <group>
      <Center top position-z={z}>
        <CurvedPlane width={width} height={width / r} radius={radius}>
          <Suspense fallback={<meshStandardMaterial side={THREE.DoubleSide} wireframe />}>
            <VideoMaterial src={src} setVideo={setVideo} />
          </Suspense>
        </CurvedPlane>
      </Center>
    </group>
  )
}

function VideoMaterial({ src, setVideo }) {
  const texture = useVideoTexture(src)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.x = -1
  texture.offset.x = 1

  setVideo?.(texture.image)

  return <meshStandardMaterial side={THREE.DoubleSide} map={texture} toneMapped={false} transparent opacity={1.0} />
}
