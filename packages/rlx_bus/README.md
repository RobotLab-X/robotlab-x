# rlx_bus

WebSocket bus client for robotlab_x subprocess services.

Subprocess services use this to publish + subscribe to the parent
backend's pub/sub bus from their own Python process. The wire grammar
is the same one the browser UI speaks (`/v1/ws`), so subprocess code
and UI code observe the same topics.

## Install

In a backend-driven workflow this package is pre-installed into every
service venv by `runtime/installer.py`. Service `pyproject.toml` files
do not need to list `rlx_bus` as a dependency — it's always there.

Outside that workflow:

```bash
pip install -e packages/rlx_bus
```

## Usage

```python
from rlx_bus import BusClient, from_env

bus = from_env()                  # reads ROBOTLAB_X_SUBPROCESS_TOKEN
                                  # + ROBOTLAB_X_BACKEND_URL
await bus.connect()

# Subscribe (handler may be sync or async)
await bus.subscribe("/myservice/control", on_control)

# Publish
await bus.publish("/myservice/state", {"ok": True}, retained=True)

# Run the consume loop until close()
await bus.consume_forever()
```

If the WS drops, `consume_forever` reconnects with a delay; pending
publishes queue in a bounded deque (default 256) and flush on reconnect.

## Wire grammar

The same one as `/v1/ws`:

```
outbound:  {id, method: 'subscribe' | 'publish' | 'unsubscribe', data: ...}
inbound:   {method: 'message' | 'ack' | 'error', topic, payload, ...}
```

## Auth

The backend mints a long-lived JWT at boot and passes it via
`ROBOTLAB_X_SUBPROCESS_TOKEN`. Same `JWT_SECRET_KEY` as user tokens,
same decode path on `/v1/ws`.
