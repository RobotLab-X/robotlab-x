Conversation-servo session ended cleanly. The normal exit path is
the engine's exit-phrase watcher firing on "terminate" or
"terminate workflow" — `result_summary` names which phrase tripped
it. The selected servo id remains persisted in
`memory/conversation_servo_config.md` so the next run resumes
without re-asking.
