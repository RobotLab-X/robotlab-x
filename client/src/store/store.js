// store.js
import { create } from "zustand"
import NameGenerator from "../framework/NameGenerator"
import Message from "../models/Message"
const store = (set, get) => ({
  // id of this process
  id: `robot-x-ui-${NameGenerator.getName()}`,

  defaultRemoteId: null,

  apiUrl: "http://localhost:3001/api/v1/services", // Initial base URL value
  setApiUrl: (url) => set({ apiUrl: url }), // Setter for baseUrl

  repoUrl: "http://localhost:3001/repo", // Initial base URL value
  setRepoUrl: (url) => set({ repoUrl: url }), // Setter for baseUrl

  getMessageApiUrl: () => {
    // if (process.env.REACT_APP_MESSAGE_BASE_URL) {
    //   return process.env.REACT_APP_MESSAGE_BASE_URL
    // }

    // let urlParts = new URL(window.location.href)
    // const scheme = urlParts.protocol.replace(":", "")
    // const hostname = urlParts.hostname
    // // const port = urlParts.port || (scheme === "https" ? "8443" : "80")
    // const port = urlParts.port // 5000
    // const wsSchema = scheme === "https" ? "wss" : "ws"

    // const wsUrl = `${wsSchema}://${hostname}:${port}/api/messages?user=root&pwd=pwd&session_id=2309adf3dlkdk&id=${
    //   get().id
    // }`
    // return wsUrl

    // if (process.env.NODE_ENV === "production") {
    //   let urlParts = new URL(window.location.href)
    //   const scheme = urlParts.protocol.replace(":", "")
    //   const hostname = urlParts.hostname
    //   const port = urlParts.port || (scheme === "https" ? "8443" : "80")
    //   const wsSchema = scheme === "https" ? "wss" : "ws"
    //   const wsUrl = `${wsSchema}://${hostname}:${port}/api/messages?user=root&pwd=pwd&session_id=2309adf3dlkdk&id=${
    //     get().id
    //   }`
    //   return wsUrl
    // } else {
    //   // for development
    //   // const wsUrl = `ws://localhost:8888/api/messages?user=root&pwd=pwd&session_id=2309adf3dlkdk&id=${get().id}`
    //   const wsUrl = process.env.REACT_APP_MESSAGE_BASE_URL
    //   return wsUrl
    // }

    return `ws://localhost:3001/api/messages?user=root&pwd=pwd&session_id=2309adf3dlkdk&id=${get().id}`
  },

  /**
   * dictionary of services with last known state
   */
  registry: {},

  /**
   * @type {Service} repo - The service repository of types
   * @description This is a dictionary of service types, keyed by the simple name of the service. typeKey@version
   */
  repo: {},

  /**
   * @type {WebSocket} socket - The websocket connection
   */
  socket: null,

  /**
   * @type {boolean} connected - True if the websocket is connected
   */
  connected: false,

  /**
   * @type {boolean} connecting - True if the websocket is connecting
   */
  connecting: false,

  data: {},

  /**
   * @type {Message} messages - A dictonary of the latest messages received from the server,
   * keyed by the message name and method.
   */
  messages: {},

  updateRegistryOnRegistered: (data) =>
    set((state) => {
      const key = data.name + "@" + data.id
      return {
        registry: {
          ...state.registry,
          [key]: data
        }
      }
    }),

  updateRegistry: (newRegistry) => set({ registry: newRegistry }),

  updateRepo: (newRepo) => set({ repo: newRepo }),

  addToRepo: (key, value) =>
    set((state) => ({
      repo: { ...state.repo, [key]: value }
    })),

  connect: (url) => {
    if (!url) {
      // if url is not explicitly set
      url = get().getMessageApiUrl()
      console.log(`store is connecting to ${url}`)
    }

    // running in dev mode has a irritating habit of trying to connect
    // twice - this will prevent that
    if (get().connected || get().connecting) {
      console.log("already connected or connecting.")
      return
    }

    set({
      connecting: true
    })
    const socket = new WebSocket(url)

    socket.onopen = () => {
      console.info("websocket opened")
      set({
        socket: socket
      })
      set({
        connected: true
      })
      set({
        connecting: false
      })

      // either create service call or
      // you'll need to register, subscribe and send

      // connected to a runtime instance

      // subscribe and prepare to query myrobotlab instance
      get().subscribeTo("runtime", "getServiceNames")
      get().subscribeTo("runtime", "getService")
      get().sendTo("runtime", "getServiceNames")
    }

    socket.onclose = () => {
      console.info("websocket closed")
      set({
        socket: null
      })
      set({
        connected: false
      })
      set({
        connecting: false
      })
    }

    socket.onerror = (error) => {
      console.error("websocket error:", error)
    }

    socket.onmessage = (event) => {
      if (event.data === "X") {
        // atmosphere protocol ping
        return
      }

      let msg = JSON.parse(event.data)

      console.info(`in-msg --> ${msg.name}.${msg.method} ${JSON.stringify(msg.data)}`)

      try {
        let key = msg.name + "." + msg.method

        // handle the initial query of services
        if (key === `runtime@${get().id}.onServiceNames`) {
          // first message returned - make it the defaultRemoteId
          const atIndex = msg.sender.indexOf("@")
          if (atIndex !== -1) {
            set({ defaultRemoteId: msg.sender.substring(atIndex + 1) })
          }

          // ask for each service
          for (const serviceName of msg.data[0]) {
            console.info(serviceName)
            get().sendTo("runtime", "getService", serviceName)
          }
        }

        // populate the registry
        if (key === `runtime@${get().id}.onService`) {
          get().registry[msg.data[0].name + "@" + msg.data[0].id] = msg.data[0]
        }

        if (key === `runtime@${get().id}.onRegistered`) {
          msg.data[0].id = get().defaultRemoteId
          get().updateRegistryOnRegistered(msg.data[0])
        }

        if (key === `runtime@${get().id}.onRegistry`) {
          set({ registry: msg.data[0] })
        }

        if (key === `runtime@${get().id}.onRepo`) {
          set({ repo: msg.data[0] })
        }

        let reflectedKey = msg.name + "." + msg.method

        let remoteKey = null
        if (msg.name.includes("@")) {
          const prefix = msg.name.split("@")[0]
          remoteKey = `${prefix}@${get().defaultRemoteId}.${msg.method}`
        } else {
          remoteKey = `${msg.name}@${get().defaultRemoteId}.${msg.method}`
        }

        // equivalent of MQTT RETAIN
        // store the message
        console.info(`storing message ${remoteKey} ${JSON.stringify(msg)}`)

        set((state) => ({
          messages: {
            ...state.messages,
            [remoteKey]: { ...msg }
          }
        }))

        let test = get().messages[key]
        // console.info('onmessage end')
      } catch (error) {
        console.error(error)
      }
    }
  },
  getMsg: (name, method) => {
    let key = name + "." + method
    const messages = get().messages

    if (messages.hasOwnProperty(key)) {
      return messages[key]
    } else {
      return null
    }
  },
  sendJsonMessage: (json) => {
    const socket = get().socket
    if (socket) {
      socket.send(json)
    } else {
      console.error("no socket connection.")
    }
  },

  // FIXME no need to double encode
  sendMessage: (msg) => {
    // GOOD DEBUGGING
    // console.info('out-msg <-- ' + msg.name + '.' + msg.method)
    // msg.encoding = "json"
    // if (msg.data) {
    //   for (let i = 0; i < msg.data.length; i++) {
    //     msg.data[i] = JSON.stringify(msg.data[i])
    //   }
    // }

    var json = JSON.stringify(msg)
    get().sendJsonMessage(json)
  },

  sendTo: function (name, method) {
    var args = Array.prototype.slice.call(arguments, 2)
    var msg = get().createMessage(name, method, args)
    // msg.sendingMethod = "sendTo"
    get().sendMessage(msg)
  },

  subscribeTo: function (name, method) {
    // FIXME- merge more args
    var args = Array.prototype.slice.call(arguments, 1)
    var msg = get().createMessage(name, "addListener", [method, "runtime" + "@" + get().id])
    // msg.sendingMethod = "subscribeTo"
    get().sendMessage(msg)
  },

  getFullName: (name) => {
    // FIXME - fix correctly
    return name
  },

  createMessage: (inName, inMethod, inParams) => {
    // TODO: consider a different way to pass inParams for a no arg method.
    // rather than an array with a single null element.
    const remoteId = "mrl-id"
    const id = "react-app-id"

    // var msg = {
    //   msgId: new Date().getTime(),
    //   name: get().getFullName(inName),
    //   method: inMethod,
    //   sender: "runtime@" + id,
    //   sendingMethod: null
    // }
    let msg = new Message()

    msg.name = get().getFullName(inName)
    msg.method = inMethod
    msg.sender = "runtime@" + id

    if (inParams || (inParams.length === 1 && inParams[0])) {
      msg["data"] = inParams
    }
    return msg
  },

  disconnect: () => {
    console.info("disconnecting")
    const { socket } = get().socket
    if (socket) {
      socket.close()
    }
  }
})

export const useStore = create(store)
export const direct = useStore
