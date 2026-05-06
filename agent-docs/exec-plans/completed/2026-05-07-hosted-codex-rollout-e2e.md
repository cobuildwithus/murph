# Hosted Codex Rollout E2E

## Goal

Add one robust hosted-runtime E2E regression proving active Codex rollout continuity survives checkpoint, local workspace loss, restore, and native thread-id resume.

Success criteria:

- The test drives the Cloudflare workspace bridge and hosted runtime job rather than only unit-level bundle helpers.
- A first hosted Codex notification turn creates Codex resume state and an active rollout JSONL.
- The local vault and hosted Codex home are deleted to simulate container teardown.
- A second hosted Codex notification turn restores from the latest checkpoint and resumes the same Codex thread by thread id.
- The second provider prompt proves the Codex stub loaded prior assistant history from the restored rollout JSONL.
- The resulting checkpoint includes only the manifest-referenced rollout under `.codex-hosted/sessions/...` and excludes Codex logs, prompt history, SQLite, and unreferenced Codex continuity files.

## Scope

Primary files:

- `apps/cloudflare/test/hosted-runtime-checkpoint-baseline-e2e.test.ts`
- `packages/operator-config/src/assistant/target-runtime.ts` if the E2E exposes a required provider-id compatibility fix
- `packages/assistant-runtime/src/hosted-runtime/codex-e2e-app-server-stub.ts` if the E2E harness needs deterministic UUID thread ids
- `packages/assistant-engine/src/assistant/notification-turn.ts` if the E2E exposes notification resume-state persistence gaps
- `packages/assistant-engine/src/assistant/provider-turn/planning.ts` if the E2E exposes thread-scope selection gaps
- `packages/assistant-engine/src/assistant/provider-route.ts` if the E2E exposes route identity dependence on volatile hosted paths
- `packages/assistant-engine/test/provider-seams.test.ts` for focused route-identity seam coverage
- `packages/assistant-engine/test/assistant-notification-turn-runtime.test.ts` for focused notification persistence expectations

Coordination-only files:

- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- this plan

## Approach

Extend the existing hosted checkpoint E2E suite because it is already part of the hosted-local checkpoint scenario and exercises the Cloudflare bridge snapshot path.

The new test will:

1. Start a local Responses-style stub used by the hosted Codex app-server shim.
2. Run `runHostedWorkspaceRuntimeJobInProcess()` through `createHostedWorkspaceRuntimeBridgeJobOptions()`.
3. Feed an `assistant.notification.requested` mailbox wake through a test decoder so the real system-mailbox notification path runs.
4. Use the hosted Codex app-server stub with UUID threads and rollout files enabled.
5. Let the first checkpoint persist the session resume state and rollout manifest.
6. Remove local workspace directories before the second run.
7. Assert the second run resumes the same thread from the restored rollout and that snapshot contents stay precise.

The initial implementation also exposed that hosted runtime hands assistant-engine the effective Codex provider id `hosted-openai`; the provider serializer must treat that id as Codex-reserved so hosted Codex notification turns can execute through the generated Codex config.

It also exposed that notification turns need explicit session-thread continuity when they are being used as active assistant sessions: the notification profile must persist provider resume state after a provider turn, and explicit `session-thread` scope must win over the default `automation-cron` isolation fallback. Plain automation turns without that explicit profile remain isolated. Skip decisions still persist provider resume state when a provider thread was minted, so skipped notifications do not strand a new Codex thread without durable resume state.

The route identity fix must be narrow: hosted `.codex-hosted` homes get a stable route fingerprint because their absolute parent directory is container-local, but ordinary explicit local Codex homes remain part of the route fingerprint.

## Verification

Focused:

- `pnpm exec vitest run --config apps/cloudflare/vitest.e2e.config.ts --no-coverage apps/cloudflare/test/hosted-runtime-checkpoint-baseline-e2e.test.ts`
- `pnpm --dir apps/cloudflare typecheck`

Additional as needed after audit:

- `git diff --check`

## Open Questions

- None. The test should stay deterministic and use stubs only; no live Codex or live provider calls.
Status: completed
Updated: 2026-05-07
Completed: 2026-05-07
