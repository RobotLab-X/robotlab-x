// store.js
import { Url } from "url"
import { create } from "zustand"

const store = (set, get) => ({
  // id of this process
  id: "vertx-gui",

  defaultRemoteId:null,

  // this is type specific
  // need a dictionary that is per instance
  services: {},

      disconnect: () => {
    const { socket } = get().socket
    if (socket) {
      socket.close()
    }
  },
})

export const useStore = create(store)
