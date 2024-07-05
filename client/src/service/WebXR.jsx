import Link from "@mui/material/Link"

export default function WebXR({ name, fullname, id }) {
  console.debug(`TestNodeService ${fullname}`)

  return (
    <>
      <Link href="/webxr">WebXR</Link>
    </>
  )
}
