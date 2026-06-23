# Hosted Runtime Maintenance Wake Rollout

## Goal

Add the smallest production-safe operator primitive needed to wake hosted
workspaces after the integration-ingest hard cut deploy, so the existing
runtime-owned v1 to v2 migration runs during an explicit maintenance window
instead of first user reply admission.

Success means:

- Operators can wake active hosted workspaces from the production web app without
  pulling production secrets locally.
- Web only appends a durable runtime-control mailbox wake and reports workspace
  checkpoint status.
- The assistant runtime remains the only owner of vault restore, migration,
  validation, dirty state, and checkpointing.
- Fresh conversation input still wins over system maintenance.
- The implementation adds no migration-specific job table, queue, scheduler,
  generic migration framework, local secret export flow, or compatibility
  resolver.

## Constraints

- Clean, simple, long term maintainable, composable primitives matter more than
  making this one rollout highly automated.
- This branch is a hard cut. Once a workspace checkpoints as v2, rolling the
  runtime back to pre-v2 code is not a clean fallback. Treat the rollout as
  fix-forward after the first successful v2 checkpoint.
- The migration core does not take an `AbortSignal`. A maintenance wake can be
  interrupted during the idle checkpoint wait, but not in the middle of one
  migration call.
- Web must not inspect or mutate vault contents. It can only observe
  `hosted_workspace.version`, `checkpointed_at`, and signal acceptance.
- Runtime-control signals must stay payload-free and metadata-only.
- Do not use the browser-vault refresh wake for this. It has the right mechanics
  but the wrong semantics and can couple the rollout to browser-vault replica
  refresh behavior.

## Code Facts Rechecked

- `packages/assistant-runtime/src/hosted-runtime.ts` runs
  `ensureHostedVaultFormatCurrentForRuntime` immediately after restore and before
  mailbox import. On the current branch it applies
  `runIntegrationIngestMigration({ apply: true, maxBundles: 500 })` until the
  vault stores the current format.
- When that migration mutates, the runtime folds the mutation into
  `runtimeStateDirty` and starts the normal idle checkpoint timer. The Cloudflare
  default idle checkpoint delay is 180 seconds.
- `packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts` imports
  conversation mailbox work first. It imports the system lane only when there is
  no foreground conversation work.
- `runSystemMailboxMaintenancePhase` returns immediately when fresh conversation
  input exists or background maintenance should yield.
- Only `runtime.manual-requested` continues into assistant automation after a
  runtime-control receipt. Other runtime-control wakes are recorded as receipts
  without assistant work.
- `packages/hosted-execution` already owns runtime-control wake contracts and
  payload builders. The existing builder is payload-free:
  `eventId`, `kind`, `occurredAt`, `userId`.
- `apps/web/src/lib/hosted-orchestration/signal-runtime.ts` already has the
  durable append-then-signal pattern for runtime-control mailbox work.
- `apps/web/src/lib/hosted-runtime-latency/ops-access.ts` already has the right
  security shape for ops pages: hosted app session plus
  `HOSTED_OPS_MEMBER_IDS`.
- `checkpointHostedWorkspaceTx` increments `hosted_workspace.version` on each
  accepted checkpoint behind the existing expected-version CAS fence.

## Final Primitive

Introduce a neutral runtime-control mailbox kind:

```ts
"runtime.maintenance-requested"
```

Semantics:

- Admit the restored hosted runtime for one normal pass.
- If the restored vault is legacy, the existing runtime admission migration runs
  before mailbox import.
- The mailbox item is processed as a runtime-control receipt.
- It does not continue the assistant lane.
- It does not request browser-vault replica refresh.
- It does not bypass AI usage gating by pretending to be assistant work; it is
  simply not an AI-gated system item.

This is a runtime wake primitive, not a migration primitive. The v1 to v2 rollout
is one use of it.

## Implementation Plan

1. Extend the hosted execution runtime-control contract.
   - Add `"runtime.maintenance-requested"` to
     `HOSTED_EXECUTION_RUNTIME_CONTROL_WAKE_KINDS`.
   - Add parser switch arms in `packages/hosted-execution/src/parsers.ts`.
   - Update hosted-execution contract, parser, and builder tests that enumerate
     runtime-control kinds.

2. Route the new kind through assistant-runtime as a no-op runtime-control
   receipt.
   - Add it to `ACTION_BY_KIND` in
     `packages/assistant-runtime/src/hosted-runtime/mailbox-routing.ts`.
   - Add it to the no-op runtime-control case in
     `packages/assistant-runtime/src/hosted-runtime/events.ts`.
   - Add assistant-runtime tests proving the maintenance receipt is imported and
     recorded, does not quarantine, and does not continue assistant automation.
   - Do not change `shouldContinueAssistantLaneAfterSystemMailboxPreparation`;
     manual requests should remain the only runtime-control kind that continues
     assistant automation.

3. Add a durable web signal helper.
   - Add `signalHostedRuntimeMaintenanceRuntime` beside
     `signalHostedBrowserVaultRefreshRuntime`.
   - Reuse `signalHostedRuntimeControlMailboxRequest`.
   - Use a deterministic event id over user id, current workspace version, a
     short minute bucket, and action version.
   - Do not call the AI usage gate.
   - Keep the mailbox envelope payload-free.
   - Add tests for append-before-signal, deterministic dedupe, Temporal failure
     preserving the mailbox append, active-workspace enforcement, and no prompt
     or payload data in the Temporal signal.

4. Factor generic hosted ops access.
   - Move the existing `HOSTED_OPS_MEMBER_IDS` parsing and allowlist check into
     `apps/web/src/lib/hosted-ops/access.ts`.
   - Keep or replace `requireHostedRuntimeLatencyOpsAccess` with a wrapper that
     calls the generic page-access helper.
   - Add a request-access helper for mutation routes that uses the hosted app
     session from the request and the existing hosted onboarding origin check.
   - Do not introduce a bearer token unless a future headless ops need is proven.

5. Add the maintenance ops service and page.
   - Add `apps/web/src/lib/hosted-ops/runtime-maintenance.ts`.
   - Candidate query: active, non-suspended hosted members with an existing
     hosted workspace and non-null `snapshotRef`.
   - Page: `apps/web/app/(dashboard)/ops/runtime-maintenance/page.tsx`.
   - Mutation route: an allowlisted POST used only by the ops page, with bounded
     `limit` and optional cursor. It wakes at most a small batch per request.
   - Status route or page refresh: read current workspace `version` and
     `checkpointedAt` for the requested users and compare to the version
     captured before wake.
   - Do not persist a rollout job row. Browser state plus deterministic dedupe
     is enough for this one-time operation; if the page is refreshed, the
     operator can safely request another maintenance wake.

6. Keep rollout controls intentionally manual.
   - Default batch size: 1 for canary, then 2 or 3 once the first checkpoint
     advances.
   - Stop on the first timed-out or failed workspace.
   - Do not add automated retries beyond letting an operator click again after
     the dedupe bucket changes.

## Rollout Runbook

1. Merge and deploy the branch only when a maintenance window is acceptable.
2. Deploy the Cloudflare runner/runtime that understands
   `"runtime.maintenance-requested"` before using the web ops page.
3. Deploy the web app with the ops page after the Cloudflare deployment is live.
4. Do not click the maintenance action until Cloudflare and web are on the same
   supporting commit.
5. Open `/ops/runtime-maintenance` as a member in `HOSTED_OPS_MEMBER_IDS`.
6. Refresh candidates and confirm the count matches active hosted workspaces
   with snapshots.
7. Wake one canary workspace that already passed temp-copy migration.
8. Wait for `hosted_workspace.version` to advance and `checkpointedAt` to update.
   Expect migration time plus the normal idle checkpoint delay.
9. Wake batches of 2 or 3 until all candidates have advanced at least once after
   the deploy.
10. If a workspace has not advanced after 10 minutes, stop the rollout and
    inspect hosted runtime logs for that user. Repair explicitly and fix forward.
11. After all candidates have advanced, send one final no-op maintenance wake to
    a migrated workspace as a smoke check. It should checkpoint quickly or remain
    no-op with no blockers.

## Stress Test

| Scenario | Expected behavior | Plan response |
| --- | --- | --- |
| Operator clicks before Cloudflare supports the new kind | Old runtime may quarantine or fail the unknown system item | Deploy Cloudflare first and do not expose/use the page until same-commit support is live |
| Duplicate click in the same minute | Same deterministic event id for same workspace version | Safe duplicate mailbox append/dedupe semantics; Temporal signals can repeat |
| Page refresh loses pending state | No durable job row exists | Re-run status/candidate read and click again after dedupe window if needed |
| Workspace is already v2 | Runtime migration no-ops | Receipt path records maintenance without assistant work |
| Workspace has migration blockers | Runtime fails before durable checkpoint | Status never advances; stop batch and repair explicitly |
| Fresh user message exists before system import | Conversation lane wins | Maintenance item waits behind conversation work |
| Fresh user message arrives during idle checkpoint wait | Dirty wait is interruptible by runtime wake | Foreground work can preempt the wait |
| Fresh user message arrives during one migration call | Core migration call is not abortable | Keep batch size small and run in a low/no-traffic window |
| Checkpoint CAS loses to another runtime | Checkpoint conflict prevents stale write | Status remains pending or advances through the winning runtime; operator rechecks |
| Rollback after some v2 checkpoints | Pre-v2 runtime may not read v2 snapshots | Treat rollout as fix-forward after first v2 checkpoint |
| Production secrets needed locally | Local env pull is avoided | Operation runs inside production web with existing env and app-session auth |
| Need to know whether vault is v1 from web | Web cannot know without restore | Use version advancement as web-visible proof; migration validation remains runtime-owned |

## Verification Plan

For the implementation:

- `pnpm typecheck`
- `pnpm test:diff packages/hosted-execution/src/contracts.ts packages/hosted-execution/src/parsers.ts packages/assistant-runtime/src/hosted-runtime/mailbox-routing.ts packages/assistant-runtime/src/hosted-runtime/events.ts apps/web/src/lib/hosted-orchestration/signal-runtime.ts apps/web/src/lib/hosted-ops/runtime-maintenance.ts`
- Focused tests:
  - `packages/hosted-execution/test/hosted-runtime-control.test.ts`
  - `packages/hosted-execution/test/parsers.test.ts`
  - `packages/assistant-runtime/test/hosted-runtime-mailbox-routing.test.ts`
  - `packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts`
  - `apps/web/test/hosted-orchestration-signal-runtime.test.ts`
  - a new hosted ops runtime-maintenance service/route test
- `git diff --check`

If `pnpm test:diff` is not truthful for the touched web and runtime owners, use
the package/app scoped verification required by `agent-docs/operations/verification-and-runtime.md`.

## Rejected Alternatives

- Pull production env locally and run a script: exposes secrets to the wrong
  place and makes the local machine an operational dependency.
- Temporary public admin route called from a laptop: repeats the same operational
  friction with a worse trust boundary.
- Reuse browser-vault refresh: semantically wrong and can trigger unrelated
  replica work.
- Add a migration job table or queue: more state than the rollout needs.
- Move migration into a pre-shutdown hook: creates a second mutation location and
  still needs dirty checkpoint ownership.
- Fail old vaults closed in the hot reply path only: simple code, but bad
  product behavior for any workspace not pre-migrated.
- Add v1 compatibility resolver: against the hard-cut architecture.

## State

Active.

## Done

- Rechecked runtime migration admission, dirty checkpointing, mailbox lane
  ordering, runtime-control contracts, web signal helper, ops access, and
  workspace checkpoint CAS behavior on `codex/land-integration-ingest-hard-cut`
  at `b73e2381b`.
- Stress-tested the primitive against deployment skew, duplicate clicks,
  checkpoint delay, user-message races, failed migrations, and rollback.

## Next

- Implement the primitive exactly as scoped above.
- Run the verification plan.
- Deploy Cloudflare first, then web, then run the maintenance wake batches during
  the agreed window.
