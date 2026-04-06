# @murphai/assistant-engine

Workspace-private headless assistant execution runtime for Murph.

This package owns the assistant turn runtime, provider execution path, tool-catalog and model-harness helpers, assistant state/outbox/status/store surfaces, the local gateway adapter used by the daemon and hosted runtimes, and the canonical shared vault/inbox leaf modules that `@murphai/vault-inbox` still re-exports where its higher-level orchestration has not yet diverged. Provider-target normalization plus hosted provider preset/config utilities are owned by `@murphai/operator-config` and consumed here directly.
