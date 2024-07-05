import Link from "@mui/material/Link"

export default function WebXR({ name, fullname, id }) {
  console.info(`TestNodeService ${fullname}`)

  return (
    <>
      <Link href="/webxr">WebXR</Link>
    </>
  )
}
