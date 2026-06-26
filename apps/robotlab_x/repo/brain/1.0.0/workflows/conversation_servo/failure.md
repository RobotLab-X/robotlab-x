Conversation-servo run ended with a failure — see `summary.json` /
`failure_reason` for the specific guard. Common causes:

- `timeout_seconds=86400` exceeded: 24 hours of continuous run.
  Restart the workflow if you want to keep going.
- adapter error from the Anthropic backend (auth / 429 / network).
  Check the brain config and the `requests.jsonl` for the last
  outbound payload.
- safety_gate `topic_pattern` denial: the model tried to address a
  topic outside `/servo/*/control`, `/chat/*/control`, or
  `/brain/*/control` — review `steps.jsonl` for the rejected
  action.

The persisted servo selection in
`memory/conversation_servo_config.md` is untouched, so a re-run
will pick up where this one left off.
