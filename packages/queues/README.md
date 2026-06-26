# Queues - General Queues package

> **Parent**: [packages](../README.md) · **Repo root**: [Repo Root](../../README.md)

This is the `queues` Python library.

The `queues` package provides shared abstractions and utilities for working with distributed task queues and message passing in CloudSeeder applications. It enables reliable background processing, inter-service communication, and async workflows across apps.

## Purpose

- Centralize queue and messaging logic for all apps
- Provide reusable interfaces for queue producers and consumers
- Support multiple queue backends (e.g., Redis, SQS, in-memory)
- Enable scalable, decoupled background task execution

## Typical Contents

- Queue client and worker base classes
- Message serialization/deserialization helpers
- Task dispatch and result tracking utilities
- Common queue configuration and connection logic

## Usage

Import and extend queue classes or utilities in your app to implement background jobs, event-driven workflows, or inter-service messaging:

```python
from queues import BaseQueueWorker, QueueMessage

class MyWorker(BaseQueueWorker):
	...
```

Update this README if new queue patterns or supported backends are added.
