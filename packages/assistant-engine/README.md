# @murphai/assistant-engine

Workspace-private headless assistant execution runtime for Murph.

This package owns headless assistant execution and assistant-specific tool surfaces. That includes the assistant turn runtime, Codex app-server provider execution path, direct CLI prompt/bootstrap guidance, assistant state/outbox/status/store surfaces, assistant automation, and input/tool integration points for the daemon and hosted runtimes.

Neutral vault services live in `@murphai/vault-usecases/vault-services`, and inbox service composition lives in `@murphai/inbox-services`. `assistant-engine` consumes those owners instead of owning their factories. Canonical writes still terminate in `packages/core`. Provider-target normalization plus hosted provider preset/config utilities are owned by `@murphai/operator-config` and consumed here directly.

## Codex Warmth

Codex app-server turns reuse one warm process per Node runtime/container when
the process launch key matches, including command, args, working directory,
Codex home, and the exact sanitized child env passed to the Codex process.
A turn is an RPC into that process rather than a per-turn app-server
subprocess. Overlapping turns fail busy instead of spawning parallel app-server
processes.

Per-thread settings such as model, model provider, approval policy, sandbox,
and cwd are sent through thread RPC. Native resume validates Codex's returned
thread context before starting a turn; if the resume path is stale, the provider
starts a fresh thread for the same user turn instead of failing to reply.
Provider-table authority should be passed as explicit `--config` process args
by the provider path; those args are already part of launch identity.

Codex accepts dynamic tools on `thread/start`, persists them in rollout session
metadata, and restores them when a cold `thread/resume` does not provide a new
tool list. Murph therefore keeps native thread continuity across app-server
replacement instead of reconstructing a bounded transcript as a new thread.
This applies to every registered dynamic tool, including the private
`murph.assistant_style` surface; no tool-specific stale-resume fallback is
needed.

The hosted CLI bridge keeps one process-lifetime loopback server but rotates its
bearer for every active invocation. Because the bearer is part of the sanitized
child env and launch identity, a later hosted invocation replaces the resident
app-server and resumes its native thread instead of letting a stale terminal
inherit later route or device-sync authority. At the end of each hosted turn,
assistant-engine asks Codex to clean the thread's background terminals; Codex
owns those terminals and terminates their process groups. A cleanup RPC failure
poisons and replaces the resident app-server. A prior invocation's bearer is
unauthorized; the container still consumes authenticated requests that cross
the current invocation's closing boundary and stops warm Codex fail-closed.

Turn prompts, session ids, turn ids, and delivery routes are request data, not
child process env. If a value should not affect warm reuse, keep it out of the
Codex process env and pass it through RPC or a runtime-owned request seam.
Hosted turns read the current delivery route through the CLI bridge when a
command needs that invocation-scoped context; local assistant commands must pass
explicit route flags instead of relying on ambient env.

Hosted runtime env projection remains owned by the hosted runtime before it
calls assistant-engine. The app-server lifecycle is shared: launch-key mismatch,
abort cleanup, malformed output, off-turn output, process failure, or idle
explicit shutdown stops or poisons the warm process before a later turn can
reuse it.

## Dynamic tool contracts

Route planning is the single owner of the dynamic tool contract. It resolves the
exact tool array once, fingerprints that array, and stores it on
`AssistantRouteTurnPlan.dynamicTools`. Provider conversion forwards the complete
turn object, and Codex sends that same array in `thread/start`; downstream layers
must not rebuild it from copied gate booleans.

Runtime authority remains independent of advertisement. Hosted transports are
typed services on `AssistantHostedToolContext`, and each tool checks that service
again when invoked. Adding a tool therefore requires only:

1. defining and dispatching the tool in `src/assistant-codex/dynamic-tools.ts`;
2. exposing any required typed service through `AssistantHostedToolContext`; and
3. including the tool in the planning-time `resolveMurphDynamicTools` call.

Do not add per-tool availability booleans to provider or app-server inputs.
