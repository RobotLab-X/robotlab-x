import { getAuthToken } from '../lib/api'

// Server-sent frame the UI receives over /v1/ws.
export interface InboundFrame {
  method: 'message' | 'ack' | 'error' | 'topics'
  id?: string
  topic?: string
  payload?: unknown
  sender_id?: string
  reply_to?: string
  timestamp?: number
  error?: string
  delivered?: number
  subscribed?: boolean
  topics?: TopicInfo[]
}

export interface TopicInfo {
  name: string
  subscriber_count: number
  retained: boolean
  /** Total messages dropped on this topic across all subscribers due to
   *  bounded per-subscriber queues. Reflects slow-consumer pressure. */
  dropped?: number
}

export type TopicHandler = (frame: InboundFrame) => void

/**
 * MQTT-style topic match — mirrors runtime/bus.py and rlx_bus's matcher.
 * '+' matches exactly one segment, terminal '#' matches zero or more
 * trailing segments. Used to route incoming 'message' frames to wildcard
 * subscribers.
 */
function topicMatchesPattern(topic: string, pattern: string): boolean {
  if (!pattern.includes('+') && !pattern.endsWith('#') && !pattern.includes('/#/')) {
    return topic === pattern
  }
  const pSegs = pattern.split('/')
  const tSegs = topic.split('/')
  // '#' must be terminal; if it appears anywhere else, no match.
  for (let i = 0; i < pSegs.length - 1; i++) {
    if (pSegs[i] === '#') return false
  }
  for (let i = 0; i < pSegs.length; i++) {
    const ps = pSegs[i]
    if (ps === '#') return true
    if (i >= tSegs.length) return false
    if (ps === '+') continue
    if (ps !== tSegs[i]) return false
  }
  return pSegs.length === tSegs.length
}

interface SubscriptionRecord {
  topic: string
  handlers: Set<TopicHandler>
  ackPending: boolean
  // Resolvers waiting on the next server ack for this topic. Cleared on
  // ack delivery. Used by awaitSubscribed() so request/reply flows can
  // guarantee the server-side pump is registered BEFORE publishing —
  // without this guarantee, a fast responder (e.g. an instant in-process
  // method) can answer before the pump exists and the reply drops.
  readyResolvers: Array<() => void>
}

// Pending one-shot request → response correlation. Resolved by frame id
// when the matching response frame arrives.
interface PendingRequest {
  resolve: (frame: InboundFrame) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

// Live connection state. Useful as a UI signal — the header indicator
// renders green/amber/red against these three values.
export type WsState = 'connected' | 'connecting' | 'disconnected'
export type StateListener = (state: WsState) => void

// Traffic tap — every frame the client SENDS or RECEIVES on the wire is
// also pushed to subscribed taps. Used by the Traffic monitor page.
export interface TrafficEvent {
  /** Wall-clock time the frame was observed by the client. */
  ts: number
  /** Which side the frame was crossing. */
  direction: 'out' | 'in'
  /** Parsed frame (best-effort JSON for raw outbound strings). */
  frame: Record<string, unknown>
}
export type TrafficListener = (ev: TrafficEvent) => void

/**
 * Configuration for a WsClient instance.
 *
 * ``baseUrl`` is the runtime's origin — ``http(s)://host[:port]``. The
 * client appends ``/v1/ws`` and rewrites the scheme to ws/wss. Pass
 * ``location.origin`` for the default same-origin connection (what the
 * legacy module-level singleton uses); pass a fully-qualified URL like
 * ``http://10.0.0.5:8998`` for a connection to a different runtime.
 *
 * ``getToken`` is a function-valued callback so the client always reads
 * the current token — important because tokens rotate via refresh +
 * because the multi-runtime UI keeps tokens in memory per connection
 * rather than in a single localStorage slot.
 */
export interface WsClientConfig {
  baseUrl: string
  getToken: () => string | null
}

/**
 * One WebSocket per instance. Reconnects with exponential backoff +
 * jitter when the server closes us.
 *
 * Today the UI uses ONE instance (``wsClient`` module-export at the
 * bottom of this file) targeting the same origin the SPA was served
 * from. The class is constructable on its own so a multi-runtime UI
 * can hold a Map<runtime_id, WsClient> and route per-runtime traffic
 * without singleton coupling.
 */
class WsClient {
  private readonly cfg: WsClientConfig
  private socket: WebSocket | null = null
  private connecting = false
  private subscriptions = new Map<string, SubscriptionRecord>()
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private nextFrameId = 1
  // Frames queued while we're between sockets — sent in order on reconnect.
  private outbound: string[] = []
  // One-shot request/response correlation (list_topics today, potentially
  // more later). Keyed by frame id.
  private pending = new Map<string, PendingRequest>()
  // Connection state + observers for the UI indicator.
  private state: WsState = 'disconnected'
  private stateListeners = new Set<StateListener>()
  // Traffic-tap observers. Independent of subscription routing — these
  // see every frame regardless of topic, used by the Traffic monitor.
  private trafficListeners = new Set<TrafficListener>()
  // Recent-frames ring buffer. A freshly-mounted Traffic page reads this
  // on subscribe so the user sees what already crossed the wire (within
  // this tab) instead of having to start at zero. Cross-tab traffic comes
  // through BroadcastChannel and bypasses this buffer.
  private trafficBuffer: TrafficEvent[] = []
  private trafficBufferCap = 200
  // Per-topic latest-message cache. Keyed by the concrete topic of the
  // last 'message' frame delivered to a subscription. When a NEW
  // handler subscribes to a topic that already has an existing
  // subscription, the server doesn't re-send the retained payload
  // (it only delivers retained on the FIRST subscribe per topic).
  // We replay the cached message to the new handler so late
  // subscribers see the same initial state every other handler did.
  // Bounded by the live-subscription set: when no handler remains for
  // a topic, its cache entry is dropped.
  private lastMessageByTopic = new Map<string, InboundFrame>()

  constructor(cfg: WsClientConfig) {
    this.cfg = cfg
  }

  /** The runtime origin this client is bound to. Exposed so the
   * multi-runtime layer can label chips with the URL the user typed
   * before they've learned the runtime_id. */
  get baseUrl(): string { return this.cfg.baseUrl }

  /** Current live state — synchronous read for one-off use. Prefer
   * subscribeState() / useWsState() for components that should re-render
   * on transitions. */
  getState(): WsState {
    return this.state
  }

  /** Subscribe to the raw frame stream. Returns an unsubscribe function.
   * Sees every frame regardless of topic, in both directions — including
   * frames from OTHER tabs in the same browser, mirrored via
   * BroadcastChannel. Cheap when no listeners are attached. */
  subscribeTraffic(listener: TrafficListener): () => void {
    this.trafficListeners.add(listener)
    this.ensureTrafficChannel()
    // Backfill from the recent-frames buffer so a freshly-mounted Traffic
    // page lands with context instead of an empty list.
    for (const ev of this.trafficBuffer) {
      try { listener(ev) } catch (err) { console.error(err) }
    }
    return () => {
      this.trafficListeners.delete(listener)
    }
  }

  private trafficChannel: BroadcastChannel | null = null

  private ensureTrafficChannel(): void {
    if (this.trafficChannel) return
    if (typeof BroadcastChannel === 'undefined') return  // older browsers
    this.trafficChannel = new BroadcastChannel('rlx-traffic')
    this.trafficChannel.onmessage = (msg: MessageEvent) => {
      const ev = msg.data as TrafficEvent
      // Mirror from other tabs — don't re-broadcast (would loop).
      for (const cb of this.trafficListeners) {
        try { cb(ev) } catch (err) { console.error(err) }
      }
    }
  }

  private emitTraffic(direction: 'in' | 'out', frame: Record<string, unknown>): void {
    const ev: TrafficEvent = { ts: Date.now(), direction, frame }
    // Park in the ring buffer first so freshly-mounted Traffic pages
    // can backfill from here.
    this.trafficBuffer.push(ev)
    if (this.trafficBuffer.length > this.trafficBufferCap) {
      this.trafficBuffer.splice(0, this.trafficBuffer.length - this.trafficBufferCap)
    }
    // Local listeners first (this tab).
    for (const cb of this.trafficListeners) {
      try {
        cb(ev)
      } catch (err) {
        console.error('wsClient traffic listener threw', err)
      }
    }
    // Always mirror to other tabs of the same origin. The Composer-side
    // tab may not have a Traffic listener of its own, but a Traffic page
    // open in another tab still needs to see what the Composer sends.
    this.ensureTrafficChannel()
    if (this.trafficChannel) {
      try {
        this.trafficChannel.postMessage(ev)
      } catch (err) {
        console.error('wsClient broadcast failed', err)
      }
    }
  }

  /** Subscribe to state transitions. Returns an unsubscribe function.
   * Receives the new state right after the transition fires. */
  subscribeState(listener: StateListener): () => void {
    this.stateListeners.add(listener)
    // Push current state immediately so freshly-mounted components don't
    // wait for the next transition to render the right colour.
    try {
      listener(this.state)
    } catch (err) {
      console.error('wsClient state listener threw', err)
    }
    return () => {
      this.stateListeners.delete(listener)
    }
  }

  private setState(next: WsState): void {
    if (this.state === next) return
    this.state = next
    for (const cb of this.stateListeners) {
      try {
        cb(next)
      } catch (err) {
        console.error('wsClient state listener threw', err)
      }
    }
  }

  connect(): void {
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return
    if (this.connecting) return

    const token = this.cfg.getToken()
    if (!token) {
      // No session — no socket. Caller should retry after sign-in.
      this.setState('disconnected')
      return
    }
    this.connecting = true
    this.setState('connecting')
    const url = `${this.wsBaseUrl()}/v1/ws?token=${encodeURIComponent(token)}`
    const ws = new WebSocket(url)
    this.socket = ws

    ws.onopen = () => {
      this.connecting = false
      this.reconnectAttempt = 0
      this.setState('connected')
      // Re-subscribe every active topic.
      for (const sub of this.subscriptions.values()) {
        this.send({ id: this.frameId(), method: 'subscribe', data: { topic: sub.topic } })
        sub.ackPending = true
      }
      // Flush any frames queued while disconnected.
      for (const frame of this.outbound.splice(0)) ws.send(frame)
    }

    ws.onmessage = (ev) => {
      let frame: InboundFrame
      try {
        frame = JSON.parse(ev.data) as InboundFrame
      } catch {
        return
      }
      this.emitTraffic('in', frame as unknown as Record<string, unknown>)

      // Request/response correlation by frame id (list_topics, etc.).
      if (frame.id && this.pending.has(frame.id)) {
        const pending = this.pending.get(frame.id)!
        // Topic-bearing acks are still subscription bookkeeping — only
        // resolve the pending request if this frame doesn't belong to a
        // topic subscribe/unsubscribe flow.
        if (frame.method === 'topics' || frame.method === 'error') {
          this.pending.delete(frame.id)
          clearTimeout(pending.timer)
          if (frame.method === 'error') {
            pending.reject(new Error(frame.error ?? 'ws error'))
          } else {
            pending.resolve(frame)
          }
          return
        }
      }

      if (!frame.topic) return
      // Route incoming 'message' frames to every subscription whose
      // registered topic matches — exact-string OR MQTT-style wildcard
      // (+ for one segment, terminal # for many). The server matches
      // wildcards too, but it delivers using the CONCRETE topic; this
      // client side has to walk its own subscription map to find which
      // wildcard handler asked for this concrete topic.
      const concreteTopic = frame.topic
      // Acks are still keyed by the topic the subscribe was called with
      // (the wildcard pattern), so exact lookup is correct for ack.
      if (frame.method === 'ack') {
        const ackSub = this.subscriptions.get(concreteTopic)
        if (ackSub) {
          ackSub.ackPending = false
          // Drain any awaitSubscribed() callers. They were parked waiting
          // for the subscribe pump on the server to be live — the ack is
          // the signal that it is.
          const resolvers = ackSub.readyResolvers.splice(0)
          for (const r of resolvers) r()
        }
        return
      }
      // Cache the most recent delivery per CONCRETE topic so late
      // subscribers on the same pattern (or exact topic) can replay
      // on subscribe. Only update the cache for 'message' frames —
      // we already filtered out 'ack' above.
      this.lastMessageByTopic.set(concreteTopic, frame)
      for (const [pattern, sub] of this.subscriptions) {
        if (pattern !== concreteTopic && !topicMatchesPattern(concreteTopic, pattern)) continue
        for (const h of sub.handlers) {
          try {
            h(frame)
          } catch (err) {
            console.error('wsClient handler error', err)
          }
        }
      }
    }

    ws.onclose = () => {
      this.socket = null
      this.connecting = false
      this.setState('disconnected')
      this.scheduleReconnect()
    }

    ws.onerror = () => {
      // onerror is followed by onclose; let the close handler reconnect.
    }
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.reconnectAttempt = 0
    if (this.socket) {
      try {
        this.socket.close()
      } catch {
        /* ignore */
      }
      this.socket = null
    }
    this.subscriptions.clear()
    this.outbound = []
    this.setState('disconnected')
  }

  subscribe(topic: string, handler: TopicHandler): () => void {
    let sub = this.subscriptions.get(topic)
    const first = !sub
    if (!sub) {
      sub = { topic, handlers: new Set(), ackPending: false, readyResolvers: [] }
      this.subscriptions.set(topic, sub)
    }
    sub.handlers.add(handler)
    if (first && this.socket?.readyState === WebSocket.OPEN) {
      this.send({ id: this.frameId(), method: 'subscribe', data: { topic } })
      sub.ackPending = true
    } else if (first) {
      // Will subscribe automatically on (re)connect.
      this.connect()
    } else {
      // The topic already has a server-side subscription (placed by a
      // prior handler), so the server WON'T re-send retained for us.
      // Replay every cached concrete-topic delivery whose path matches
      // this subscription pattern, so the new handler gets the same
      // initial-state replay every other handler did. Without this,
      // a handler that subscribes AFTER the retained payload arrived
      // would never see initial state until a fresh publish.
      const wildcard = topic.includes('+') || topic.endsWith('#')
      if (wildcard) {
        for (const [concrete, frame] of this.lastMessageByTopic) {
          if (topicMatchesPattern(concrete, topic)) {
            try { handler(frame) } catch (err) {
              console.error('wsClient handler (cached) error', err)
            }
          }
        }
      } else {
        const cached = this.lastMessageByTopic.get(topic)
        if (cached) {
          try { handler(cached) } catch (err) {
            console.error('wsClient handler (cached) error', err)
          }
        }
      }
    }
    return () => this.unsubscribeHandler(topic, handler)
  }

  publish(topic: string, payload: unknown, opts: { retained?: boolean } = {}): void {
    this.send({
      id: this.frameId(),
      method: 'publish',
      data: { topic, payload, retained: opts.retained ?? false },
    })
  }

  /**
   * Resolve as soon as the server has acked the subscription for ``topic``.
   *
   * Race this protects against: a publish-with-reply_to where the response
   * comes back faster than the client→server subscribe ack round-trip. The
   * server processes the subscribe frame BEFORE the publish (WS preserves
   * order), but the bus-side pump task it spawns is async — if the
   * responder publishes its reply before that task has registered with the
   * bus, the reply is delivered to zero subscribers and drops on the floor.
   *
   * Callers that need reply correlation should do:
   *
   *     const off = ws.subscribe(reply, handler)
   *     await ws.awaitSubscribed(reply)
   *     ws.publish(control, { action, reply_to: reply })
   *
   * If the subscription has already been acked (e.g. the topic was
   * subscribed earlier in the session), this resolves immediately.
   */
  awaitSubscribed(topic: string, timeoutMs = 4000): Promise<void> {
    const sub = this.subscriptions.get(topic)
    if (!sub) {
      return Promise.reject(new Error(`awaitSubscribed: no active subscription for ${topic}`))
    }
    if (!sub.ackPending) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Remove our resolver so the timer firing doesn't leave a leak
        // when the ack arrives later.
        const i = sub.readyResolvers.indexOf(resolve)
        if (i >= 0) sub.readyResolvers.splice(i, 1)
        reject(new Error(`awaitSubscribed: no ack for ${topic} within ${timeoutMs}ms`))
      }, timeoutMs)
      sub.readyResolvers.push(() => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  /**
   * Ask the server for the bus's current topic registry. Returns the list
   * of active topic names with their subscriber counts. Inspector polls
   * this every couple of seconds to discover what's flowing.
   */
  listTopics(timeoutMs = 4000): Promise<TopicInfo[]> {
    return new Promise<TopicInfo[]>((resolve, reject) => {
      const id = this.frameId()
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('list_topics timeout'))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (frame) => resolve(frame.topics ?? []),
        reject,
        timer,
      })
      this.send({ id, method: 'list_topics' })
    })
  }

  private unsubscribeHandler(topic: string, handler: TopicHandler): void {
    const sub = this.subscriptions.get(topic)
    if (!sub) return
    sub.handlers.delete(handler)
    if (sub.handlers.size === 0) {
      this.subscriptions.delete(topic)
      this.send({ id: this.frameId(), method: 'unsubscribe', data: { topic } })
    }
  }

  private send(frame: object): void {
    const text = JSON.stringify(frame)
    this.emitTraffic('out', frame as Record<string, unknown>)
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(text)
    } else {
      this.outbound.push(text)
      this.connect()
    }
  }

  private scheduleReconnect(): void {
    // Reconnect as long as there's a session token. Earlier this
    // function only reconnected when subscriptions/outbound frames
    // existed — which meant a freshly-logged-in user with no
    // subscriptions yet would stay disconnected until they navigated
    // to a page that subscribed. The indicator needs persistent
    // reconnect so the green light reflects reality.
    if (!getAuthToken()) return
    const attempt = ++this.reconnectAttempt
    // Exponential with cap + jitter. Caps at 30s so live workspaces
    // recover quickly when the server bounces.
    const base = Math.min(30_000, 250 * 2 ** Math.min(attempt - 1, 7))
    const jitter = Math.floor(Math.random() * 250)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, base + jitter)
  }

  private frameId(): string {
    return String(this.nextFrameId++)
  }

  /** Convert ``cfg.baseUrl`` to a ws/wss origin. Accepts http:// or
   * https:// inputs; passes through ws:// or wss:// unchanged. Trims
   * trailing slashes so the ``+ '/v1/ws'`` append produces a clean URL. */
  private wsBaseUrl(): string {
    // Dev: bypass the vite proxy for the ws. Vite's ws proxy wedges when
    // the backend restarts under it (completes the upstream handshake but
    // stops relaying the 101 to the browser), leaving the client looping
    // connect→drop until vite is restarted / the page refreshed. Connect
    // straight to the backend at the SAME host the page was loaded from
    // (so it works whether you opened localhost on-box or the Pi's LAN IP
    // remotely), on the backend port. HTTP still goes through vite. No-op
    // in production builds (import.meta.env.DEV === false → uses the
    // runtime baseUrl, which already targets the backend directly).
    if (import.meta.env.DEV && typeof window !== 'undefined') {
      const env = import.meta.env as Record<string, string | undefined>
      const port = env.VITE_WS_PORT || '8998'
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
      return `${proto}://${window.location.hostname}:${port}`
    }

    let u = (this.cfg.baseUrl || '').replace(/\/+$/, '')
    if (u.startsWith('http://')) u = 'ws://' + u.slice('http://'.length)
    else if (u.startsWith('https://')) u = 'wss://' + u.slice('https://'.length)
    return u
  }
}

// Same-origin default — preserves today's behaviour. The class is
// constructable on its own; multi-runtime UI builds a Map<id, WsClient>
// where each instance has its own baseUrl + getToken callback.
function _defaultClient(): WsClient {
  return new WsClient({
    baseUrl: typeof location !== 'undefined' ? location.origin : '',
    getToken: getAuthToken,
  })
}

export const wsClient: WsClient = _defaultClient()

// Re-export the class so the multi-runtime layer (next phase) can
// build its own instances without poking at internals.
export { WsClient }
