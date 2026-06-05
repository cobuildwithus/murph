# @murphai/assistant-engine

Workspace-private headless assistant execution runtime for Murph.

This package owns headless assistant execution and assistant-specific tool surfaces. That includes the assistant turn runtime, Codex app-server provider execution path, direct CLI prompt/bootstrap guidance, assistant state/outbox/status/store surfaces, assistant automation, and input/tool integration points for the daemon and hosted runtimes.

Neutral vault services live in `@murphai/vault-usecases/vault-services`, and inbox service composition lives in `@murphai/inbox-services`. `assistant-engine` consumes those owners instead of owning their factories. Canonical writes still terminate in `packages/core`. Provider-target normalization plus hosted provider preset/config utilities are owned by `@murphai/operator-config` and consumed here directly.

## Codex Warmth

Codex app-server turns reuse one warm process per Node runtime/container when
the process identity matches, including command, args, working directory, Codex
home/config, and child-env authority. A turn is an RPC into that process rather
than a per-turn app-server subprocess. Overlapping turns fail busy instead of
spawning parallel app-server processes.

Turn prompts, session ids, turn ids, and delivery routes are request data, not
child process env. Hosted turns read the current delivery route through the CLI
bridge when a command needs that invocation-scoped context; local assistant
commands must pass explicit route flags instead of relying on ambient env.

Hosted runtime env projection remains hosted-specific, but the app-server
lifecycle is not. Identity/config mismatch, abort cleanup, malformed output,
off-turn output, process failure, or idle explicit shutdown stops or poisons the
warm process before a later turn can reuse it.
