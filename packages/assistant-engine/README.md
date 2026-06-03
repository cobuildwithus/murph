# @murphai/assistant-engine

Workspace-private headless assistant execution runtime for Murph.

This package owns headless assistant execution and assistant-specific tool surfaces. That includes the assistant turn runtime, Codex app-server provider execution path, direct CLI prompt/bootstrap guidance, assistant state/outbox/status/store surfaces, assistant automation, and input/tool integration points for the daemon and hosted runtimes.

Neutral vault services live in `@murphai/vault-usecases/vault-services`, and inbox service composition lives in `@murphai/inbox-services`. `assistant-engine` consumes those owners instead of owning their factories. Canonical writes still terminate in `packages/core`. Provider-target normalization plus hosted provider preset/config utilities are owned by `@murphai/operator-config` and consumed here directly.

## Hosted Codex Warmth

Hosted Codex app-server warmth is Phase A same-identity reuse. The package keeps
at most one hosted Codex app-server process and reuses it only when the full
process identity matches, including the env/config authority digest, and the
process is idle, initialized, healthy, and unpoisoned.

This is not broad cross-invocation reuse. Cross-invocation warmth is eligible
only after runtime authority is scoped per turn or per request instead of being
embedded in long-lived process env/config.
