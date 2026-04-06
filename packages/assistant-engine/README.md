# @murphai/assistant-engine

Workspace-private headless assistant execution runtime for Murph.

This package now owns the canonical assistant, vault, inbox, knowledge, and shared usecase surfaces consumed across the workspace. That includes the assistant turn runtime, provider execution path, tool-catalog and model-harness helpers, assistant state/outbox/status/store surfaces, the local gateway adapter used by the daemon and hosted runtimes, plus the integrated vault/inbox service factories and shared usecase/query helpers that previously straddled a separate `vault-inbox` owner split. Provider-target normalization plus hosted provider preset/config utilities are owned by `@murphai/operator-config` and consumed here directly.
