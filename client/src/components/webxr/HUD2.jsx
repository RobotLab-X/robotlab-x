// TODO use a fastapi router project creator
import React, { useRef, useEffect, useContext, useState, useMemo, Suspense } from "react"
import { PoseText } from "../../layout/PoseText"
import { useFrame, createPortal, useThree } from "@react-three/fiber"
import { useXR } from "@react-three/xr"
import { deltaPose, getEvent, getPose } from "../../framework/WebXrUtils"
import { VRButton, ARButton, XR, Controllers, Hands, useXREvent, useController } from "@react-three/xr"
import { Pane, Plane, useFBO, OrthographicCamera, Box, Text, Html } from "@react-three/drei"

// FIXME - not sure I like absolute paths, this should probably be relative
import OpenCV2 from "./service/OpenCV2"
import { useStore } from "../../store/store"
import CurvedPlane from "./CurvedPlane"

export const HUD2 = (props) => {
  console.info("HUD2 start", props.name)
  let serviceName = props.name

  // const sendTo = useStore((state) => state.sendTo, [ useStore((state) => state.sendTo)])
  // const sendTo = useStore((state) => state.sendTo, [state.sendTo]);
  const sendTo = useStore((state) => state.sendTo)

  const threshold = 0.01

  // Hold state for hovered and clicked events
  const [hovered, hover] = useState(false)
  const [clicked, click] = useState(false)
  const [controllerData, setControllerData] = useState({})
  const [eventData, setEventData] = useState()

  let precision = 2

  // This reference gives us direct access to the THREE.Mesh object
  const ref = useRef()

  const {
    // An array of connected `XRController`
    controllers,
    // Whether the XR device is presenting in an XR session
    isPresenting,
    // Whether hand tracking inputs are active
    isHandTracking,
    // A THREE.Group representing the XR viewer or player
    player,
    // The active `XRSession`
    session,
    // `XRSession` foveation. This can be configured as `foveation` on <XR>. Default is `0`
    foveation,
    // `XRSession` reference-space type. This can be configured as `referenceSpace` on <XR>. Default is `local-floor`
    referenceSpace,
  } = useXR()

  const left = useController("left")
  const right = useController("right")
  const headset = useController("none")

  const handleSqeezeStart = (xrEvent) => {
    let event = getEvent(xrEvent)
    setEventData(event)
    sendTo(serviceName, "publishEvent", event)
  }

  const handleSqueezeEnd = (xrEvent) => {
    let event = getEvent(xrEvent)
    setEventData(event)
    sendTo(serviceName, "publishEvent", event)
  }

  useXREvent("squeezestart", handleSqeezeStart)
  useXREvent("squeezeend", handleSqueezeEnd)

  // callback only happens when in VR
  // data changes only happen when in VR
  useFrame(() => {
    if (controllers.length >= 2 && session) {
      let p = left.controller.position
      let r = left.controller.rotation

      let pose = getPose("left", p, r)

      if (deltaPose(pose, controllerData[pose.name], threshold)) {
        let data = { left: pose }
        setControllerData((controllerData) => ({ ...controllerData, ...data }))
        console.log(controllerData)
        sendTo(serviceName, "publishPose", pose)
      }

      p = right.controller.position
      r = right.controller.rotation

      pose = getPose("right", p, r)

      if (deltaPose(pose, controllerData[pose.name], threshold)) {
        let data = { right: pose }
        setControllerData((controllerData) => ({ ...controllerData, ...data }))
        console.log(controllerData)
        sendTo(serviceName, "publishPose", pose)
      }
    }

    if (player && session) {
      // head ... maybe
      let p = player.children[0].position
      let r = player.children[0].rotation
      // console.info(pose.position)

      let pose = getPose("head", p, r)

      if (deltaPose(pose, controllerData[pose.name], threshold)) {
        let data = { head: pose }
        setControllerData((controllerData) => ({ ...controllerData, ...data }))
        sendTo(serviceName, "publishPose", pose)
      }
    }

    // TODO - get joystick info here
    if (session) {
      //console.info(session)

      session.inputSources.forEach((inputSource) => {
        // Check if the input source has a gamepad
        if (inputSource.gamepad) {
          // Access the thumbstick (joystick) position from the axes array
          const [xAxis, yAxis] = inputSource.gamepad.axes

          // The joystick position is represented as values between -1 and 1
          // console.log(`Joystick X-axis position: ${inputSource.handedness} ${xAxis}`);
          // console.log(`Joystick Y-axis position: ${yAxis}`);
        }
      })
    }

    // setCounter((counter) => counter + 1)
  }) // useFrame

  function Object(props) {
    console.info("Object start")

    return (
      <group>
        <Text position={[0, 0.5, -1.8]} scale={0.04}>
          {" "}
          {JSON.stringify(eventData)}{" "}
        </Text>
        <PoseText
          poseName="head"
          position={[0, -1, -1.8]}
          scale={0.04}
          controllerData={controllerData}
          precision={precision}
        />
        <PoseText
          poseName="left"
          position={[-0.6, -1, -1.8]}
          scale={0.04}
          controllerData={controllerData}
          precision={precision}
        />
        <PoseText
          poseName="right"
          position={[0.6, -1, -1.8]}
          scale={0.04}
          controllerData={controllerData}
          precision={precision}
        />
      </group>
    )
  }

  function CameraLinkedObject() {
    console.info("CameraLinkedObject start")

    const camera = useThree((state) => state.camera)
    return createPortal(<Object position={[0, 0, 0]} />, camera)
  }

  console.info("HUD2 render xxx")
  return (
    <group>
      <CameraLinkedObject />
    </group>
  )
}
