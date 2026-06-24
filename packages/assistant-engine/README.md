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

Known upstream limitation: Codex accepts dynamic tools only on `thread/start`
and drops them to an empty list on a cold `thread/resume` (no resume or turn
field re-sends them, and rollouts do not persist tool specs), so natively
resumed threads after a process restart run without `murph.*` dynamic tools
until the contract fingerprint forces a fresh thread. Warm same-process
rejoins keep their tools. Fix belongs upstream; do not add Murph-side
workarounds without a concrete product failure that traces attribute to this.

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

## Adding a new dynamic tool gate

When you add a new tool (or capability flag that gates one) to `MURPH_DYNAMIC_TOOLS`
in `src/assistant-codex/dynamic-tools.ts`, the gate value has to travel the full
provider input chain. Every hop is explicit field enumeration, not a spread, so
a missing line silently defaults the gate to `false` and the tool disappears
from the registered tool list without any type error.

Touch all of these when adding a gate field:

1. `src/assistant/providers/types.ts` — add to `AssistantProviderTurnInput` and
   `AssistantProviderTurnExecutionInput`.
2. `src/assistant/codex-runtime.ts` — forward in both
   `executeCodexAssistantTurnFromInput` and `executeCodexAssistantTurnAttemptFromInput`
   (they re-enumerate fields into the execution input).
3. `src/assistant/providers/codex-cli.ts` — set on `baseAppServerInput`.
4. `src/assistant-codex.ts` — add to `CodexAppServerTurnInput`.
5. `src/assistant-codex/app-server-requests.ts` — read in `resolveCodexAppServerDynamicTools`.
6. `src/assistant-codex/dynamic-tools.ts` — gate the new tool in `resolveMurphDynamicTools`
   AND dispatch in `executeMurphDynamicToolRequest`.
7. `src/assistant/codex-turn-runner.ts` and `src/assistant/codex-turn/planning.ts` —
   read from `executionContext.hosted` and pass through.
8. `src/assistant/execution-context.ts` — preserve the field through
   `normalizeAssistantExecutionContext`.

If the gate originates outside the assistant engine, also update
`packages/assistant-runtime/src/hosted-runtime/platform.ts` (`HostedRuntimePlatform`),
`packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts`
(executionContext build), and the cloudflare runtime factory in
`apps/cloudflare/src/runtime-platform/platform-factory.ts`. Confirm end-to-end by
asking the assistant to list tools whose name starts with the new prefix; a missing
hop never throws — the tool just silently disappears.
