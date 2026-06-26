Could not complete the reflection. Check the step log for the
specific failure — common causes:

* The configured ollama model doesn't support tool calls (try
  llama3.1, llama3.2, qwen2.5, mistral-nemo).
* The ollama base URL is unreachable (use Test Backend in the
  Controls modal to verify).
* The model produced no tool call within max_steps (rare; the
  prompt is explicit about the two-step format).
