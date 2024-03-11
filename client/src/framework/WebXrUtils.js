export function deltaPose(pose0, pose1, threshold) {
  if (!pose0 || !pose1) {
    return true
  }

  return (
    Math.abs(pose0.position.x - pose1.position.x) > threshold ||
    Math.abs(pose0.position.y - pose1.position.y) > threshold ||
    Math.abs(pose0.position.z - pose1.position.z) > threshold ||
    Math.abs(pose0.orientation.roll - pose1.orientation.roll) > threshold ||
    Math.abs(pose0.orientation.pitch - pose1.orientation.pitch) > threshold ||
    Math.abs(pose0.orientation.yaw - pose1.orientation.yaw) > threshold
  )
}

export function getPose(name, position, orientation) {
  return {
    name: name,
    position: {
      x: position.x,
      y: position.y,
      z: position.z,
    },
    orientation: {
      roll: orientation._z,
      pitch: orientation._x,
      yaw: orientation._y,
    },
  }
}

export function getEvent(xrEvent) {
  let event = {
    id: xrEvent?.target?.uuid,
    type: xrEvent?.nativeEvent?.type,
    value: true,
    meta: {
      handedness: xrEvent?.target?.inputSource.handedness,
    },
  }
  return event
}
