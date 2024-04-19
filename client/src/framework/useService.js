import { useState } from "react"
import { useStore } from "store/store"

/**
 * To be used instead or super class as a common hook
 * @param {*} initialId
 * @param {*} initialName
 * @returns
 */
function useService(initialId, initialName) {
  const [id, setId] = useState(initialId)
  const [name, setName] = useState(initialName)

  const sendTo = useStore((state) => state.sendTo)

  const getId = () => id
  const getName = () => name

  const send = (method, ...message) => {
    console.log(`send ${name}@${id}.${method}(${message})`)
    sendTo(getFullName(), method, ...message)
  }

  const subscribe = (topic) => {
    console.log(`Component ${name} subscribing to ${topic}`)
  }

  const unsubscribe = (topic) => {
    console.log(`Component ${name} unsubscribing from ${topic}`)
  }

  const getFullName = () => {
    return `${name}@${id}`
  }

  return {
    getId,
    getName,
    setId,
    setName,
    send,
    subscribe,
    unsubscribe,
    getFullName
  }
}

export default useService
