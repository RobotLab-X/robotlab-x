import * as React from "react"

// Props should put in "name"
// and all service types defined here
// the consumer of this and other "views" of components need to be responsible
// to make a layout that has the appropriat "typed" component and injected prop name

export default function TestNodeService({ name, fullname, id }) {
  console.debug(`TestNodeService ${fullname}`)
  return <>TestNodeService - this is for all your testing needs</>
}
