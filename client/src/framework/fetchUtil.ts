async function fetchGetJson(origin: string, path: string) {
  const url = `${origin}${path}`
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

// FIXME test this - not sure if origin is correct for PUT vs GET
async function fetchPutJson(origin: string, path: string, body: any) {
  const url = `${origin}/${path}`
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
