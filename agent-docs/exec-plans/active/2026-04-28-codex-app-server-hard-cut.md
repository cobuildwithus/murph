# Codex App Server Hard Cut

Status: active implementation plan
Owner: parent integrator plus Codex worker lanes
Timebox: 3 hours

## Goal

Replace Murph's bespoke assistant model/runtime loop around the Vercel AI SDK and OpenAI-compatible provider path with a greenfield Codex App Server runner.

The hard cut should delete as much duplicated provider, tool-binding, model-harness, and OpenAI-compatible request-shaping code as possible. Murph should keep the product/runtime envelope it owns: mailbox import, leases, auth boundaries, active-turn journaling, hosted checkpoints, canonical vault writes through `packages/core`, outbox finalization, and channel delivery.

Target flow:

```text
iMessage / Telegram / Email / CLI / hosted wake
  -> Murph mailbox, lease, and auth boundary
  -> Codex app-server runner
  -> Codex calls vault-cli / murph directly
  -> packages/core writes canonical vault events
  -> Murph checkpoints, drains outbox, and sends replies
```

## Locked Decisions

- Greenfield hard cut is allowed. No existing user/session/config migration is required.
- Existing OpenAI-compatible assistant sessions may break with a clear reconfigure-Codex error or be discarded.
- Hosted assistant execution should use Codex App Server, not the old OpenAI-compatible runtime.
- Hosted model provider should be Vercel AI Gateway through Codex provider config.
- Default hosted model is `gpt-5.5` with medium reasoning.
- Hosted provider wire API is `responses` only for this cut.
- Hosted runner may use `danger-full-access` for now inside the container/process runtime boundary.
- Noninteractive approval policy is `never`.
- `inbox model route` can be deleted or disabled if it depends on the AI SDK.
- Murph web/search/PDF bound tools can be deleted/disabled for this cut. Codex-native web capability can be used only if it is already available through Codex.
- Verification target is `pnpm typecheck` plus focused package tests and residue scans. Full acceptance is best-effort only.
- Parallel Codex workers may spawn their own subagents for bounded subtasks. Workers should not create commits.

## Non-Negotiables

- Do not expose local usernames, home paths, legal names, secrets, raw API keys, raw authorization headers, or direct personal identifiers in code, docs, prompts, logs, tests, or handoff.
- Preserve unrelated dirty work. Workers share the current worktree and must not revert edits they did not make.
- Cloudflare stays a thin execution coordinator. It should not become an agent harness, mailbox owner, assistant state owner, or product control plane.
- Codex and `vault-cli` run in a process runtime that can execute local commands. Do not contort Workers into hosting the agent loop.
- Canonical product truth stays under the vault/core mutation path. Assistant runtime state stays execution residue.
- Hosted secrets are forwarded as environment values only to the isolated runner/Codex child that needs them. Persisted Codex config should refer to env var names, not secret values.
- Fail closed when a removed OpenAI-compatible/AI SDK path is requested.

## Target Runtime Shape

### Assistant Runner

Introduce or converge on a single assistant runner boundary around Codex App Server:

```ts
interface CodexAppServerRunner {
  runTurn(input: CodexRunTurnInput, observer: CodexTurnObserver): Promise<CodexRunTurnResult>
  steer(input: CodexSteerInput): Promise<CodexSteerResult>
  interrupt(input: CodexInterruptInput): Promise<void>
  close(): Promise<void>
}
```

Runner responsibilities:

- Launch `codex app-server`.
- Send `initialize` / `initialized`.
- `thread/start` or `thread/resume`.
- `turn/start`.
- Stream and normalize app-server events.
- Capture Codex `threadId`, Codex `turnId`, final assistant text, usage where available, and provider action counts.
- Support `turn/steer` for active user messages while a turn is running.
- Support `turn/interrupt` before process termination.
- Map process exits, stale resume, auth/profile/model errors, and protocol errors to existing Murph error semantics.
- Materialize local image inputs.
- Redact local paths and secret-adjacent values before durable logs/diagnostics.

The runner should expose `modelProvider` because the installed Codex App Server protocol includes `modelProvider` on thread start/resume/fork params and responses, while the current repo adapter only forwards `model`.

### Hosted Provider Config

Hosted config should select Codex plus Vercel AI Gateway. The external env shape can stay simple:

```text
HOSTED_ASSISTANT_PROVIDER=vercel-ai-gateway
HOSTED_ASSISTANT_MODEL=gpt-5.5
HOSTED_ASSISTANT_REASONING_EFFORT=medium
HOSTED_ASSISTANT_APPROVAL_POLICY=never
HOSTED_ASSISTANT_SANDBOX=danger-full-access
VERCEL_AI_API_KEY=<secret>
```

Runtime should generate Codex config equivalent to:

```toml
model = "gpt-5.5"
model_provider = "vercel-ai-gateway"
model_reasoning_effort = "medium"

[model_providers.vercel-ai-gateway]
name = "Vercel AI Gateway"
base_url = "https://ai-gateway.vercel.sh/v1"
env_key = "VERCEL_AI_API_KEY"
wire_api = "responses"
```

Implementation can use App Server params and `--config` overrides rather than writing permanent config when that is simpler and safer. The important invariant is that provider diversity moves behind Codex config, not Murph's AI SDK client construction.

### Active-Turn Input

Correctness belongs to Murph's active-turn journal and hosted mailbox checkpoint, not to provider-native resume alone.

For a same-conversation message while Codex is thinking:

1. Import/materialize the inbound message.
2. Append accepted-input journal entries.
3. Append transcript rows where applicable.
4. In hosted mode, checkpoint mailbox import and accepted input before making it provider-visible.
5. Call Codex `turn/steer` against the live `{ threadId, turnId }`.
6. If steering is unavailable or rejected before commit, continue via explicit Murph history on the next provider-safe boundary.
7. If commit has started, classify the late input as next-turn work.

Steering must be fenced by Murph session id, Murph turn id, conversation key, Codex thread id, and Codex turn id.

### Cloudflare Boundary

Cloudflare owns:

- Durable Object routing, leases, alarms, retry/poison state, and nudge coalescing.
- Encrypted workspace/artifact/env object movement.
- Container start, invoke, status, timeout, and cleanup.
- Signed callback transport to hosted web.

Cloudflare does not own:

- Codex thread state.
- Active-turn queues.
- Mailbox cursors.
- Assistant outbox truth.
- Provider history.
- Product facts.
- Any generic agent harness.

### Process Runtime Boundary

The process runtime owns:

- Restoring the workspace.
- Creating invocation-local `CODEX_HOME` or equivalent Codex config scope.
- Building Codex provider config/overrides.
- Launching Codex App Server.
- Ensuring `vault-cli` and `murph` are discoverable to Codex.
- Importing mailbox rows.
- Running assistant turns.
- Refreshing/checkpointing active-turn input.
- Finalizing outbox/checkpoint/usage.
- Scrubbing child env and process logs.

## What To Delete

Delete outright where typecheck allows:

- `packages/assistant-engine/src/assistant/providers/openai-compatible.ts`
- AI SDK execution functions from `packages/assistant-engine/src/model-harness/model-spec.ts`
- AI SDK tool binding from `packages/assistant-engine/src/model-harness/tool-catalog.ts`
- Responses/gateway request mutation in `packages/assistant-engine/src/model-harness/responses-policy.ts`
- OpenAI-compatible provider registry entries.
- OpenAI-compatible model discovery and catalog branches.
- AI SDK bound-tool profile creation.
- Provider failover across OpenAI-compatible/Responses/Codex families.
- Vercel AI Gateway billing/request-header shaping inside assistant-engine provider runtime.
- `packages/cli/src/inbox-model-runtime.ts`
- `packages/cli/src/inbox-model-harness.ts` if it is still AI SDK-backed.
- Assistant command flags that configure OpenAI-compatible clients directly.
- Hosted OpenAI-compatible bootstrap.
- AI SDK dependencies from `packages/assistant-engine/package.json`, `packages/cli/package.json`, and `pnpm-lock.yaml`.

Keep or adapt:

- `packages/assistant-engine/src/assistant-codex.ts` and `assistant-codex/**`, but reshape into the Codex runner seam.
- Assistant local service, turn lock, active-turn journal, turn finalizer, transcripts, diagnostics, status, outbox, automation, cron, and channel delivery.
- Hosted mailbox import/checkpoint/outbox/device-sync/vault-sync runtime envelope.
- CLI domain commands that Codex should call directly.
- Operator config only where it describes Codex, Vercel AI Gateway-as-Codex-provider, or legacy fail-closed parsing.

## Parallel Worker Lanes

The prepared prompts live under `.codex-prompts/codex-app-server-hard-cut/`.

Recommended launch model:

- Wave 1 immediately: workers 01 through 06.
- Wave 2 after initial source edits settle or after roughly 70-80 minutes: workers 07 and 08.
- Parent integrator stays local, watches `git status`, resolves cross-lane conflicts, and runs verification.

All workers edit the current shared worktree. They must not commit.

### Worker 01: Operator Config Codex-Only

Owns:

- `packages/operator-config/src/assistant-cli-contracts.ts`
- `packages/operator-config/src/assistant/provider-config.ts`
- `packages/operator-config/src/assistant/target-runtime.ts`
- `packages/operator-config/src/assistant-backend.ts`
- `packages/operator-config/src/assistant/hosted-config.ts`
- `packages/operator-config/src/hosted-assistant-config.ts`
- `packages/operator-config/src/hosted-assistant-config-constants.ts`
- `packages/operator-config/src/setup-cli-contracts.ts`
- directly coupled operator-config tests only if unavoidable

Responsibilities:

- Make Codex the only active assistant runtime target.
- Add/normalize `modelProvider` for Codex.
- Map `vercel-ai-gateway` hosted provider selection to Codex model provider config.
- Remove active `responses` and `openai-compatible` runtime behavior.
- Preserve only minimal legacy parsing if required to emit fail-closed errors.

### Worker 02: Codex App Server Runner

Owns:

- `packages/assistant-engine/src/assistant-codex.ts`
- `packages/assistant-engine/src/assistant-codex/**`
- directly coupled Codex runtime tests

Responsibilities:

- Add `modelProvider` to Codex app-server input and thread params.
- Expose or implement `turn/steer`.
- Keep `turn/interrupt` and improve turn id capture.
- Keep app-server event normalization and final-message extraction.
- Keep failure handling and path/secret redaction.

### Worker 03: Assistant Engine Execution Cut

Owns:

- `packages/assistant-engine/src/assistant/providers/**`
- `packages/assistant-engine/src/assistant/provider-turn-runner.ts`
- `packages/assistant-engine/src/assistant/provider-turn/**`
- `packages/assistant-engine/src/assistant/provider-catalog.ts`
- `packages/assistant-engine/src/assistant/provider-config.ts`
- `packages/assistant-engine/src/assistant/service-turn-routes.ts`
- `packages/assistant-engine/src/assistant/session-resolution.ts`
- `packages/assistant-engine/src/assistant/store/**`
- `packages/assistant-engine/src/assistant/state-secrets.ts`
- directly coupled assistant-engine tests if needed for compile

Responsibilities:

- Remove OpenAI-compatible execution from the active provider registry.
- Collapse chat execution to Codex.
- Delete provider-family failover and AI SDK usage attribution.
- Fail closed for old OpenAI-compatible sessions.
- Preserve Murph turn envelope.

### Worker 04: Tool Runtime And Prompt Cut

Owns:

- `packages/assistant-engine/src/model-harness/**`
- `packages/assistant-engine/src/model-harness.ts`
- `packages/assistant-engine/src/assistant-cli-tools/**`
- `packages/assistant-engine/src/assistant/system-prompt.ts`
- `packages/assistant-engine/src/assistant-cli-access.ts`
- `packages/assistant-engine/src/assistant/cli-surface-bootstrap.ts`
- prompt/tool/capability tests only if needed

Responsibilities:

- Delete AI SDK tool binding.
- Delete bound assistant tools that duplicate direct `vault-cli` / `murph` command authority.
- Remove `vault.cli.run` as a provider-visible tool.
- Remove prompt language about AI SDK tools and OpenAI-compatible tool aliases.
- Keep only neutral content types/helpers that Codex path still needs; move them if required.

### Worker 05: CLI And Inbox Cut

Owns:

- `packages/cli/src/commands/model.ts`
- `packages/cli/src/commands/inbox.ts`
- `packages/cli/src/inbox-model-runtime.ts`
- `packages/cli/src/inbox-model-harness.ts`
- `packages/cli/src/inbox-model-contracts.ts`
- `packages/cli/src/incur.generated.ts`
- `packages/assistant-cli/src/**`
- `packages/setup-cli/src/**`
- directly coupled CLI/setup tests if required

Responsibilities:

- Make assistant model/setup commands Codex-only.
- Remove assistant chat OpenAI-compatible flags.
- Disable/delete AI SDK-backed `inbox model route`.
- Preserve `inbox model bundle` if deterministic and useful.
- Regenerate incur artifacts if command topology changes.

### Worker 06: Hosted Runtime And Cloudflare Codex

Owns:

- `packages/assistant-runtime/src/hosted-runtime/**`
- `packages/assistant-runtime/src/hosted-env-categories.ts`
- `packages/assistant-runtime/src/hosted-runtime.ts`
- `apps/cloudflare/src/**`
- `Dockerfile.cloudflare-hosted-runner*`
- hosted runtime/cloudflare tests only if required

Responsibilities:

- Consume the Codex-only hosted config from operator-config.
- Forward `VERCEL_AI_API_KEY` only to the runtime child/Codex process.
- Ensure hosted runtime can create/use Codex config for Vercel AI Gateway Responses.
- Keep Cloudflare as coordinator only.
- Add smoke/preflight seams for `codex --version` / `codex app-server --help` if practical.

### Worker 07: Tests And Fixtures

Owns:

- `packages/assistant-engine/test/**`
- `packages/operator-config/test/**`
- `packages/assistant-runtime/test/**`
- `packages/cli/test/**`
- `apps/cloudflare/test/**`
- fixtures directly coupled to removed provider/model route behavior

Responsibilities:

- Delete obsolete AI SDK/OpenAI-compatible tests.
- Rewrite expectations to Codex-only.
- Add coverage for `modelProvider`, Vercel AI Gateway Codex provider config, `turn/steer`, fail-closed legacy sessions, and disabled inbox route.
- Avoid source edits except tiny test-only exports or compile helpers.

### Worker 08: Integration, Dependencies, Residue

Owns:

- `packages/assistant-engine/package.json`
- `packages/cli/package.json`
- `pnpm-lock.yaml`
- package exports affected by deleted files
- docs touched only to keep active architecture truthful
- final residue scans and verification command notes

Responsibilities:

- Remove `ai`, `@ai-sdk/openai`, and `@ai-sdk/openai-compatible`.
- Update lockfile with normal package-manager flow.
- Remove stale package exports.
- Run residue scans and focused verification.
- Produce final integration notes for parent.

## Codex Workers Launch Commands

Preferred first wave:

```sh
$CODEX_HOME/skills/codex-workers/scripts/codex-workers \
  --sandbox workspace-write \
  --full-auto \
  --cd "$PWD" \
  --codex-arg -m --codex-arg gpt-5.5 \
  --codex-arg -c --codex-arg 'model_reasoning_effort="medium"' \
  .codex-prompts/codex-app-server-hard-cut/01-operator-config-codex-only.md \
  .codex-prompts/codex-app-server-hard-cut/02-codex-app-server-runner.md \
  .codex-prompts/codex-app-server-hard-cut/03-assistant-engine-execution-cut.md \
  .codex-prompts/codex-app-server-hard-cut/04-tool-runtime-and-prompts-cut.md \
  .codex-prompts/codex-app-server-hard-cut/05-cli-and-inbox-cut.md \
  .codex-prompts/codex-app-server-hard-cut/06-hosted-runtime-codex.md
```

Preferred second wave:

```sh
$CODEX_HOME/skills/codex-workers/scripts/codex-workers \
  --sandbox workspace-write \
  --full-auto \
  --cd "$PWD" \
  --codex-arg -m --codex-arg gpt-5.5 \
  --codex-arg -c --codex-arg 'model_reasoning_effort="medium"' \
  .codex-prompts/codex-app-server-hard-cut/07-tests-and-fixtures.md \
  .codex-prompts/codex-app-server-hard-cut/08-integration-deps-residue.md
```

If the team wants maximum concurrency, all eight prompts can be launched at once, but worker 07 and 08 are more effective after the first source changes start landing.

## Verification Plan

Residue checks:

```sh
rg "from 'ai'|from \"ai\"|@ai-sdk|generateText|generateObject" packages apps
rg "openai-compatible|responses" packages/assistant-engine/src packages/operator-config/src packages/cli/src packages/assistant-runtime/src apps/cloudflare/src
```

The second scan should return only intentional fail-closed legacy messages or Vercel Gateway Responses-as-Codex-provider references. It should not return an active Murph AI SDK provider.

Dependency checks:

```sh
rg '"(ai|@ai-sdk/openai|@ai-sdk/openai-compatible)"' package.json packages/*/package.json apps/*/package.json pnpm-lock.yaml
pnpm deps:guard
```

Focused verification:

```sh
pnpm typecheck
pnpm test:diff packages/assistant-engine packages/operator-config packages/assistant-runtime packages/cli apps/cloudflare
```

Fallback package checks if diff-aware verification is too broad or blocked by unrelated dirty work:

```sh
pnpm --dir packages/operator-config test:coverage
pnpm --dir packages/assistant-engine test:coverage
pnpm --dir packages/assistant-runtime test:coverage
pnpm --dir packages/cli verify:coverage
pnpm --dir apps/cloudflare verify
```

Direct smoke where practical:

```sh
codex --version
codex app-server --help
vault-cli --help
murph --help
```

## Gains

- One assistant execution model instead of parallel Codex and AI SDK runtimes.
- Less provider-specific prompt, tool, model, request, usage, and failover branching.
- App Server gives native thread ids, turn ids, streaming events, interrupt, and steer primitives.
- Hosted and local can converge on the same architecture.
- Codex owns model-provider complexity.
- Murph focuses on mailbox, state, vault writes, checkpoints, delivery, and product behavior.
- Dependency surface shrinks.
- Bound tools that duplicate CLI behavior disappear.

## Losses And Accepted Regressions

- Existing OpenAI-compatible assistant sessions/configs break.
- AI SDK provider fallback disappears.
- AI Gateway-specific request mutation, ZDR flags, gateway-only provider controls, and Stripe billing headers are removed from the assistant provider runtime.
- `inbox model route` can disappear until rebuilt on Codex or a deterministic router.
- Bound web/search/PDF helper tools can disappear until replaced or delegated to Codex-native capability.
- Some helper affordances need CLI replacements later, including current-thread reminder creation, hosted device-connect link creation, and enriched meal promotion.
- Codex App Server protocol/version compatibility becomes more important.

## Parent Integrator Checklist

- Keep workers on disjoint file ownership.
- Watch for conflicts around `operator-config`, `provider-turn/planning.ts`, and tests.
- Prefer deletion over compatibility shims.
- Keep legacy parsing only when it is necessary to fail closed cleanly.
- Do not let Workers code learn Codex semantics beyond runner env/launch coordination.
- Do not let hosted secrets reach Cloudflare supervisor logs or broad process env.
- Do not close this plan until implementation, verification, and handoff are complete.
