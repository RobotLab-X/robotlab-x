import { direct } from "store/store"

async function fetchGetJson(path: string) {
  const { apiUrl } = direct.getState()
  const url = `${apiUrl}${path}`
  console.info(`GET ${url}`)

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      }
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    return await response.json()
  } catch (error) {
    if (error instanceof Error) {
      console.error("Error in GET request:", error.message)
    } else {
      console.error("Error in GET request:", error)
    }
    throw error
  }
}

async function fetchPutJson(path: string, body: any) {
  const { apiUrl } = direct.getState()
  const url = `${apiUrl}${path}`
  console.info(`PUT ${url}`)

  try {
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
        // Add any other necessary headers here
      },
      body: JSON.stringify(body) // Convert the JavaScript object to a JSON string
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    return await response.json()
  } catch (error) {
    if (error instanceof Error) {
      console.error("Error in PUT request:", error.message)
    } else {
      console.error("Error in PUT request:", error)
    }
    throw error
  }
}

export { fetchGetJson, fetchPutJson }
