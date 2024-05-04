import React, { useEffect, useState } from "react"
import ReactJson from "react-json-view"
import { useStore } from "../store/store"
// import ReactJson from 'react-json-view'

// Props should put in "name"
// and all service types defined here
// the consumer of this and other "views" of components need to be responsible
// to make a layout that has the appropriat "typed" component and injected prop name

export default function Clock(props) {
  console.info("Clock", props)
  const subscribeTo = useStore((state) => state.subscribeTo)
  const defaultRemoteId = useStore((state) => state.defaultRemoteId)
  const message = useStore((state) => state.messages[`c1@${defaultRemoteId}.onEpoch`])

  useEffect(() => {
    // // Subscribe to changes in the 'registry' state
    // const unsubscribe = useStore.subscribe(
    //   (newRegistry) => {
    //     // Handle updates to the registry here
    //     console.log("Updated Registry:", newRegistry)
    //   },
    //   (state) => state.registry
    // )

    subscribeTo("c1", "publishEpoch")

    // // Cleanup function when component unmounts
    // return () => {
    //   unsubscribe() // Unsubscribe from the store
    // }
  }, [])

  // begin message log
  const [epoch, setEpoch] = useState([])
  useEffect(() => {
    if (message) {
      // Add the new message to the log
      console.log("New message:", message)
      setEpoch((log) => message)
    }
  }, [JSON.stringify(message)]) // Dependency array includes message, so this runs only if message changes

  // end message log

  return (
    <>
      <ReactJson src={epoch} name="epoch" />
    </>
  )
}
