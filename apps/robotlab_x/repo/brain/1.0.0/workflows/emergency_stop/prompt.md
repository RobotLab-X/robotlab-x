EMERGENCY STOP. Reason from operator:

> {reason}

Do these as fast as possible, in order:

1. Call `stop` on every running motion service (movement.*, arm.*).
2. Speak a short confirmation: "Stopped — <one-word reason>".
3. Append the stop event to memory (kind: task_history) with the
   reason and timestamp.
4. Emit `done`.

Do NOT take any other action. Do NOT try to diagnose what went wrong
— just stop, speak, log, exit. The operator decides what happens next.
