// hooks/useProcessedMessage.js
import { useEffect, useState } from "react"

/**
 * Custom hook to process incoming WebSocket messages.
 * Automatically updates state based on `msg.data[0]`.
 *
 * @param {Object} msg - The incoming message object from WebSocket.
 * @param {Function} log - Function to log message details.
 * @returns - The processed message state.
 */
export function useProcessedMessage(msg) {
  const [processedMessage, setProcessedMessage] = useState(null)

  useEffect(() => {
    if (msg) {
      // console.info("New message received:", msg)
      setProcessedMessage(msg.data[0])
    }
  }, [msg])

  return processedMessage
}
