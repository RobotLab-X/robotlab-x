# Messages - Inter-Service Contracts

> **Parent**: [packages](../README.md) · **Repo root**: [Repo Root](../../README.md)

Lightweight, typed message client utilities for small messages and alerts.

This package provides a tiny, well-typed API that encourages a clean startup-time
registration pattern and easy runtime usage. It's intentionally small and
opinionated so application code stays simple.

Key ideas
- Register clients once at application startup with `create_message_client(cfg)`.
  This function registers a singleton and intentionally returns `None` to
  emphasize that runtime code should call `get_message_client(name)`.
- Use `get_message_client(name)` anywhere in your app to retrieve the client and
  call `send_message(...)`.
- Messages use a `MessageLevel` enum (convenience constants exported from the
  package: `DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL`, `SUCCESS`).
- Convenience helpers live on the base client (for example
  `send_error_message(...)`, `send_success_message(...)`) so all clients inherit
  them automatically.
- There is no `close()` in the public API — clients are intended to be
  long-lived singletons registered at startup.

Quick examples

1) Startup (registering a client)

```python
from messages import create_message_client
from messages.google_chat import MessagesGoogleChatConfig

cfg = MessagesGoogleChatConfig(name="msg-service", webhook_url="https://example.com/webhook")
# register at startup (returns None intentionally)
create_message_client(cfg)
```

2) Runtime send (most common — content only)

```python
from messages import get_message_client
client = get_message_client("msg-service")
client.send_message("Hello world")
```

3) Supply a level (second most common)

```python
from messages import ERROR
client.send_message("Something went wrong", ERROR)
# or using the helper
client.send_error_message("Something went wrong")
```

4) Full control: content + level + recipient (third use case)

```python
from messages import INFO
client.send_message("Direct to Fred", level=INFO, recipient="Fred")
# or helper with recipient
client.send_success_message("All done", recipient="OpsTeam")
```

Examples for other clients

- Slack
```python
from messages import create_message_client, get_message_client
from messages.slack import MessagesSlackConfig

create_message_client(MessagesSlackConfig(name="slack", webhook_url="https://hooks.slack.com/...", channel="#alerts"))
client = get_message_client("slack")
client.send_message("Test")
```

- Local (prints or logs)
```python
from messages import create_message_client, get_message_client
from messages.local import MessagesLocalConfig

create_message_client(MessagesLocalConfig(name="local", use_print=True))
client = get_message_client("local")
client.send_info_message("Local info")
```

Design notes
- The `MessageLevel` enum is exported with convenient names (so callers can
  `from messages import ERROR` and pass that directly).
- `create_message_client(cfg)` should be called only at startup; runtime code
  should use `get_message_client(name)` to avoid passing secrets around.
- Helper methods (e.g. `send_error_message`) are implemented on the base
  `MessageClient` so concrete implementations get them for free.

Tests as documentation
- The test suite contains small usage-style tests that double as examples for
  the three most common patterns. Look at `packages/messages/tests/test_usage_flow.py`
  and `packages/messages/tests/test_slack_client.py` for concrete examples.

That's it — intentionally minimal and easy to adopt. If you want a sample
README snippet for a specific framework (Flask, FastAPI, etc.) I can add one.
