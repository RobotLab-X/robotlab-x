import * as THREE from "three"
import { useMemo } from "react"

export default function CurvedPlane({ width, height, radius, children, ...props }) {
  const { geometry, heightMin, heightMax } = useMemo(
    () => curvedPlaneGeometry(width, height, radius),
    [width, height, radius]
  )

  return (
    <group {...props}>
      <mesh geometry={geometry} receiveShadow castShadow position-z={-heightMax}>
        {children}
      </mesh>
    </group>
  )
}

function curvedPlaneGeometry(width = 1, height = 1, radius = 2) {
  const segments = 32
  const segmentsH = segments
  const segmentsV = segments / (width / height) // square
  const geometry = new THREE.PlaneGeometry(width, height, segmentsH, segmentsV)

  let heightMin = Infinity
  let heightMax = -Infinity

  const distanceMax = Math.sqrt((width / 2) ** 2 + (height / 2) ** 2)
  radius = Math.max(distanceMax, radius)

  const position = geometry.attributes.position
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const y = position.getY(i)

    const distance = Math.sqrt(x * x + y * y)
    const height = Math.sqrt(Math.max(radius ** 2 - distance ** 2, 0))
    heightMin = Math.min(height, heightMin)
    heightMax = Math.max(height, heightMax)
    position.setZ(i, height)
  }

  // geometry.computeVertexNormals()
  // position.needsUpdate = true

  return { geometry, heightMin, heightMax }
}
