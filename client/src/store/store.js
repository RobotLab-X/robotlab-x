// store.js

import CodecUtil from "framework/CodecUtil"
import { create } from "zustand"
import { devtools } from "zustand/middleware"

import { ProcessData } from "models/ProcessData"
import Service from "models/Service"

// import NameGenerator from "framework/NameGenerator"
import Message from "models/Message"

const UAParser = require("ua-parser-js")
const parser = new UAParser()
const browser = parser.getBrowser()

const useRegisteredService = (fullname) => {
  return useStore((state) => state.registry[fullname] || {})
}

const store = (set, get) => ({
  // id of this process
  // id: `ui-${get().defaultRemoteId}-${NameGenerator.getName()}`,
  // id: `ui-rlx`,
  // id: NameGenerator.getName(), Does not work !
  id: "ui",

  /**
   * The process/instance which
   * this UI is directly connected to
   * @type {string}
   */
  defaultRemoteId: null,

  name: "ui",

  // you can't use get inside the initial state to compute derived values
  // because get relies on the store being fully initialized
  fullname: "ui@ui",

  setName: (newName) => {
    console.log("Setting name:", newName)
    set({ name: newName })
  },

  setFullname: (newFullname) => set({ fullname: newFullname }),

  setDefaultRemoteId: (id) => set({ defaultRemoteId: id }),

  setId: (newId) => set({ id: newId }),

  debug: false,

  // dashboard layout
  layout: {},

  setDebug: (newDebug) => set({ debug: newDebug }),

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
  getRepoUrl: () => `${get().getBaseUrl()}/public/repo`,

  // Use a getter function for repoUrl - the one to use !
  getPublicUrl: () => `${get().getBaseUrl()}/public`,

  /**
   * dictionary of services with initial registered state
   */
  registry: {},

  /**
   * dictionary of services with latest state
   */
  services: {},

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

  /**
   * @type {object} statusList - A dictionary to store status messages, keyed by service name with suffix "onStatusList".
   */
  statusList: [],

  updateRegistryOnRegistered: (data) => {
    set((state) => {
      const key = data.name + "@" + data.id
      return {
        registry: {
          ...state.registry,
          [key]: data
        }
      }
    })
  },

  updateServicesOnBroadcastState: (data) =>
    set((state) => {
      const key = data.name + "@" + data.id
      return {
        services: {
          ...state.services,
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
      // All removed - handled by getRegistry
      // get().subscribeTo("runtime", "getServiceNames")
      // get().subscribeTo("runtime", "getService")
      // get().sendTo("runtime", "getServiceNames")

      let prossessData = new ProcessData(get().id, "browser", "browser", browser.name.toLowerCase(), browser.version)
      get().sendTo("runtime", "registerProcess", prossessData)

      // broadcast my state

      // TODO make these "service" calls ??? or at least one shot calls
      // that future callbacks are not needed
      // setup server runtime subscriptions, register this runtime, get repo
      // the callbacks are handled in store.js -
      // probably a good thing to avoid any unecessary re-rendering
      get().subscribeTo("runtime", "getRegistry")
      get().subscribeTo("runtime", "getRepo")
      get().subscribeTo("runtime", "registered")
      let service = new Service(get().id, get().name, "RobotLabXUI", "0.0.1", browser.name.toLowerCase())
      get().sendTo("runtime", "register", service)
      // FIXME - registerHost should be here?
      get().sendTo("runtime", "getRegistry")
      get().sendTo("runtime", "getRepo")
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

      // XXX GOOD DEBUGGING
      // console.info(`---> ${msg.name}.${msg.method} ${JSON.stringify(msg.data)}`)
      let remoteKey = `${msg.sender}.${msg.method}`

      console.info(`---> ${msg.name}.${msg.method} storing msg ${remoteKey}`)

      try {
        let key = msg.name + "." + msg.method

        // To init all services
        if (key === `${get().fullname}.onRegistry`) {
          // FIXME - replacing whole registry is dangerous
          // should iterate service by service
          // init our registry
          set({ registry: msg.data[0] })
          // iterate through registry and subscribe to all services
          Object.entries(msg.data[0]).forEach(([key, value]) => {
            get().subscribeTo(key, "broadcastState")
            get().sendTo(key, "broadcastState")
          })
        }

        // to subscribe to new services
        if (key === `${get().fullname}.onRegistered`) {
          get().updateRegistryOnRegistered(msg.data[0])
          get().subscribeTo(msg.data[0].fullname, "broadcastState")
          get().sendTo(msg.data[0].fullname, "broadcastState")
        }

        // latest update to a service
        if (key === `${get().fullname}.onBroadcastState`) {
          get().updateServicesOnBroadcastState(msg.data[0])
        }

        // equivalent of MQTT RETAIN
        // store the message
        // console.info(`storing message ${remoteKey} ${JSON.stringify(msg)}`)
        // console.info(`storing message ${remoteKey}`)

        set((state) => ({
          messages: {
            ...state.messages,
            [remoteKey]: { ...msg }
          }
        }))

        // Handle onStatus method
        if (msg.method === "onStatus") {
          msg.data[0].id = CodecUtil.getId(msg.sender)
          msg.data[0].name = CodecUtil.getShortName(msg.sender)
          // TODO add ts ?
          get().addToStatusList(msg.data[0])
        }

        let test = get().messages[key]
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
    if (!msg.sender) {
      msg.sender = `${get().name}@${get().id}`
    }

    const json = JSON.stringify(msg)

    // GOOD DEBUGGING
    if (msg.data && msg.data.length > 0) {
      console.info(`<-- ${msg.name}.${msg.method} ${JSON.stringify(msg.data)}`)
    } else {
      console.info(`<-- ${msg.name}.${msg.method}`)
    }
    // msg.encoding = "json"
    // if (msg.data) {
    //   for (let i = 0; i < msg.data.length; i++) {
    //     msg.data[i] = JSON.stringify(msg.data[i])
    //   }
    // }

    get().sendJsonMessage(json)
  },

  sendTo: function (name, method) {
    name = get().getFullName(name)
    var args = Array.prototype.slice.call(arguments, 2)
    var msg = get().createMessage(name, method, args)
    // msg.sendingMethod = "sendTo"
    get().sendMessage(msg)
  },

  subscribeTo: function (name, method) {
    // FIXME- merge more args
    var args = Array.prototype.slice.call(arguments, 1)
    var msg = get().createMessage(name, "addListener", [method, get().fullname])
    get().sendMessage(msg)
  },

  unsubscribeFrom: function (name, method) {
    // FIXME- merge more args
    var args = Array.prototype.slice.call(arguments, 1)
    console.info(`unsubscribing from ${name} ${method}`)
    var msg = get().createMessage(name, "removeListener", [method, get().fullname])
    get().sendMessage(msg)
  },

  getFullName: (name) => {
    if (!name) {
      return null
    }

    const atIndex = name.lastIndexOf("@")
    if (atIndex !== -1) {
      return name
    }

    return `${name}@${get().defaultRemoteId}`
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

    let msg = new Message()

    msg.name = get().getFullName(inName)
    msg.method = inMethod
    msg.sender = get().fullname //"runtime@" + id

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
  },

  getTypeImage: (fullname) => {
    const registered = get().registry[fullname]

    let type = registered?.typeKey || "Unknown"
    // if Proxy, then use the proxyTypeKey
    const imgType = type === "Proxy" ? registered.proxyTypeKey : type

    if (type === "MyRobotLabProxy") {
      return `${get().getRepoUrl()}/myrobotlabconnector/images/${registered.proxyTypeKey}.png`
    } else {
      if (imgType) {
        return `${get().getRepoUrl()}/${imgType.toLowerCase()}/image.png`
      } else {
        return `${get().getRepoUrl()}/unknown/image.png`
      }
    }
  },

  clearStatusList: () => {
    set((state) => ({
      statusList: []
    }))
  },
  setLayout: (newLayout) => set({ layout: newLayout }),
  saveLayout: (newLayout) => set({ layout: newLayout }),

  addToStatusList: (status) => {
    set((state) => {
      const newStatusList = [...state.statusList, status]
      if (newStatusList.length > 300) {
        newStatusList.shift() // Remove the oldest record
      }
      return { statusList: newStatusList }
    })
  }
})

const useStore = create(devtools(store))

export { useRegisteredService, useStore }

export default useStore
