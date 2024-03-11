import React from "react"
import * as THREE from "three"
import Screen from "./Screen"

const { DEG2RAD } = THREE.MathUtils

export default function Scene() {
  // const url = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4"
  // const url =
  //   "https://pmdvod.nationalgeographic.com/NG_Video/596/311/1370718787631_1542234923394_1370715715931_mp4_video_1024x576_1632000_primary_audio_eng_3.mp4"

  //  const url = "https://bitdash-a.akamaihd.net/content/MI201109210084_1/m3u8s/f08e80da-bf1d-4e3d-8899-f0f6155f6efa.m3u8"

  // const url = "/output.mp4" // from ffmpeg command line

  // const url = "/test-video.flv" // opencv ffmpeg record flv container
  // const url = "/test-video.mkv" // mkv progressive
  // const url = "/ffmpeg-mp4-file-small.mp4"
  // const url = "/example.ogg"

  const url = "http://localhost:9090/video.mkv"

  return (
    <>
      <group rotation-y={DEG2RAD * 180}>
        <Screen src={url} />
      </group>
    </>
  )
}
