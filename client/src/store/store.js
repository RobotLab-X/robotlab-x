// store.js
import { create } from "zustand"
import CodecUtil from "../framework/CodecUtil"
import NameGenerator from "../framework/NameGenerator"
import Message from "../models/Message"

const store = (set, get) => ({
  // id of this process
  id: `ui-${NameGenerator.getName()}`,
  // id: `ui-rlx`,

  defaultRemoteId: null,

  getMessageApiUrl: () => {
    return get().getWsUrl()
  },

  getBaseUrl() {
    const baseUrl = process.env.REACT_APP_BASE_URL || window.location.origin
    return baseUrl
  },

  getWsUrl() {
    const baseUrl = get().getBaseUrl()
    let wsOrigin

    if (baseUrl.startsWith("https")) {
      wsOrigin = baseUrl.replace("https", "wss")
    } else {
      wsOrigin = baseUrl.replace("http", "ws")
    }

    return `${wsOrigin}/api/messages?id=${get().id}`
  },

  // Use a getter function for apiUrl
  getApiUrl: () => `${get().getBaseUrl()}/api/v1/services`,

  // Use a getter function for repoUrl
  getRepoUrl: () => `${get().getBaseUrl()}/repo`,

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

      console.info(`---> ${msg.name}.${msg.method} ${JSON.stringify(msg.data)}`)

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
            // FIXME !! change to broadcastState()
            get().sendTo("runtime", "getService", serviceName)
          }
        }

        // populate the registry
        if (key === `runtime@${get().id}.onService`) {
          get().registry[msg.data[0].name + "@" + msg.data[0].id] = msg.data[0]
        }

        if (key === `runtime@${get().id}.onRegistered`) {
          get().updateRegistryOnRegistered(msg.data[0])
        }

        if (key === `runtime@${get().id}.onRegistry`) {
          set({ registry: msg.data[0] })
        }

        // if (key === `runtime@${get().id}.onRepo`) {
        //   set({ repo: msg.data[0] })
        // }

        let remoteKey = `${msg.sender}.${msg.method}`

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
    const json = JSON.stringify(msg)

    // GOOD DEBUGGING
    console.info(`<-- ${msg.name}.${msg.method} ${JSON.stringify(msg.data)}`)
    // msg.encoding = "json"
    // if (msg.data) {
    //   for (let i = 0; i < msg.data.length; i++) {
    //     msg.data[i] = JSON.stringify(msg.data[i])
    //   }
    // }

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
    var msg = get().createMessage(name, "addListener", [method, "runtime@" + get().id])
    get().sendMessage(msg)
  },

  unsubscribeFrom: function (name, method) {
    // FIXME- merge more args
    var args = Array.prototype.slice.call(arguments, 1)
    console.info(`unsubscribing from ${name} ${method}`)
    var msg = get().createMessage(name, "removeListener", [method, "runtime@" + get().id])
    get().sendMessage(msg)
  },

  getFullName: (name) => {
    // FIXME - fix correctly
    return name
  },

  useMessage: (fullname, method) => {
    const key = fullname + "." + CodecUtil.getCallbackTopicName(method)
    const msg = get().messages[key]
    return msg
  },

  createMessage: (inName, inMethod, inParams) => {
    // TODO: consider a different way to pass inParams for a no arg method.
    // rather than an array with a single null element.
    const id = get().id

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
