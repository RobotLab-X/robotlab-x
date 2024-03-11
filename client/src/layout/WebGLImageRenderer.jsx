import React, { useRef, useEffect } from "react"
import * as THREE from "three"
import { useStore } from "../store/store"

const WebGLImageRenderer = ({ imageUrl }) => {
  const msg = useStore((state) => state.messages["i01.opencv@vertx-vertx.onWebDisplay"])
  const canvasRef = useRef()
  // console.info("WebGLImageRenderer")
  if (msg?.data[0]) {
    imageUrl = msg.data[0].data
  }

  useEffect(() => {
    // console.info("WebGLImageRenderer.useEffect")
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000)
    const renderer = new THREE.WebGLRenderer({ canvas: canvasRef.current })

    const textureLoader = new THREE.TextureLoader()
    const texture = textureLoader.load(imageUrl)

    const geometry = new THREE.PlaneGeometry(1, 1)
    const material = new THREE.MeshBasicMaterial({ map: texture })
    const plane = new THREE.Mesh(geometry, material)

    scene.add(plane)

    camera.position.z = 0.7

    const animate = () => {
      requestAnimationFrame(animate)

      // Update animations or interactions here

      renderer.render(scene, camera)
    }

    animate()
  }, [imageUrl])

  return <canvas ref={canvasRef} />
}

export default WebGLImageRenderer
