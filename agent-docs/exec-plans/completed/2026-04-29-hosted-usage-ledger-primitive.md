# Greenfield Hosted Usage Ledger Primitive

Completed/superseded note, 2026-05-06: this plan described the former local
pending-usage export lifecycle. Hosted usage now records directly to the
web-owned usage ledger from the normalized provider-result boundary; see
`agent-docs/exec-plans/active/2026-05-06-hosted-usage-direct-recording.md`.

## Goal

Design the cleanest long-term hosted assistant usage primitive with the fewest moving parts.

Success means:

- hosted usage is accounted for durably, not treated as best-effort logging
- runtime retries are simple and idempotent
- Cloudflare remains transport/coordinator only
- `apps/web` remains the canonical hosted usage ledger owner
- usage export failures are visible without making logs part of correctness
- active-turn continuation usage is represented without lossy aggregation

## Current Code Shape

- `packages/assistant-engine/src/assistant/service-usage.ts` writes pending usage records after successful hosted provider calls.
- Pending usage records live in assistant runtime state under `.runtime/operations/assistant/**`.
- `packages/assistant-runtime/src/hosted-runtime/usage.ts` can export pending usage through an injected `usageExportPort` and delete only acknowledged records.
- `apps/cloudflare/src/runtime-platform.ts` implements `usageExportPort` by calling the signed hosted-web usage route.
- `apps/web/src/lib/hosted-execution/usage.ts` imports usage into `HostedAiUsage`.
- `packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts` currently does not call the usage exporter.
- `HostedRuntimeLog` is explicitly best-effort observability and must not become the source of truth for usage.

## Problem

Usage currently sits between two primitives:

- pending usage files are durable retry state
- hosted runtime logs are lossy observability

The missing primitive is the lifecycle step that turns pending runtime state into the web-owned hosted usage ledger.

Treating usage as logging is wrong because logs can be dropped, retained only briefly, and are not suitable for accounting, quotas, billing, or reconciliation.

## Decision

Use a durable per-provider-request usage ledger.

Each successful provider request creates one usage record with one canonical `usageId`.
The web usage table is keyed by that `usageId`.
Logical-turn aggregation, billing summaries, quota views, and dashboards should be query-layer behavior, not write-time collapsing.

This is an atomic hard cut. Do not wire runtime export until the web schema and importer accept per-provider-request usage rows. Otherwise active-turn continuation records can collide with the current `turnId + attemptCount` uniqueness rule and remain pending forever.

## Proposed Primitive

```text
provider request succeeds
write pending usage file
checkpoint workspace
export pending usage to web
delete acknowledged pending usage files
checkpoint deletion when any pending file was deleted
```

This gives at-least-once export with idempotent web ingestion.

## Ownership

Runtime owns:

- creating pending usage records
- keeping pending records in hosted workspace snapshots until exported
- deleting only acknowledged pending records

Web owns:

- the canonical hosted AI usage ledger
- usage idempotency
- billing and metering status
- queryable usage summaries

Cloudflare owns:

- signed transport from runtime to web
- runner coordination
- no durable usage facts

Runtime logs own:

- redacted breadcrumbs only
- usage export counts for observability
- no accounting truth

## Web Schema Shape

Because this is greenfield, prefer a hard cut:

- `HostedAiUsage.id` is the canonical `usageId`.
- Remove the `turnId + attemptCount` uniqueness constraint.
- Add `providerRequestOrdinal Int @default(0) @map("provider_request_ordinal")` as a first-class column.
- Add semantic uniqueness on `turnId + attemptCount + providerRequestOrdinal`.
- Keep existing indexes for `memberId + occurredAt`, feature, surface, reporting user, and Stripe metering due rows.

Rationale:

- a single logical turn attempt may legitimately make more than one provider request
- one provider request maps cleanly to one usage event
- aggregation can happen later without losing raw accounting facts
- idempotency becomes one key: `usageId`
- the semantic uniqueness constraint preserves the old duplicate-metering backstop while allowing continuation requests
- ordinal `0` is the normalized first request; nullable ordinals create ambiguous `NULL` versus `0` states

## Runtime Lifecycle

Add a small runtime export drain after the main successful workspace checkpoint.

The drain should:

- call `exportHostedPendingAssistantUsage`
- leave unacknowledged or failed records pending
- return counts: `exported`, `failed`, `pending`
- never make `HostedRuntimeLog` the source of truth

Run this drain centrally in `packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts`, not inside the assistant phase. The workspace runner owns the checkpoint lifecycle and is the only layer that can safely sequence:

```text
assistant/runtime work
main workspace checkpoint
post-checkpoint usage export
optional deletion checkpoint
```

If `exported > 0`, the exporter has deleted acknowledged pending files before returning. Run one best-effort follow-up checkpoint so that deletion is captured in the encrypted hosted workspace snapshot.

The deletion checkpoint must not make the already-checkpointed assistant work fail. If it conflicts or fails, log/surface the cleanup failure and allow the invocation to return according to the main checkpoint result. The next invocation may re-export acknowledged records; web ingestion is idempotent by `usageId`.

## Runtime Logs

Add one structured event for visibility:

- component: `runtime`
- eventCode: `runtime.usage_export_finished`
- phase: `checkpoint`
- redacted counts only:
  - `exported`
  - `failed`
  - `pending`

Do not include raw usage rows, token details, member ids, provider headers, prompts, responses, paths, or secrets in logs.

## Failure Semantics

| Failure | Result |
| --- | --- |
| provider request fails before usage exists | no usage row |
| pending usage write fails after provider success | hosted assistant turn fails; otherwise accounting can be silently lost |
| main workspace checkpoint fails | pending file remains local to failed invocation and may not become durable in hosted snapshot |
| export call fails | pending file remains and next invocation retries |
| web imports row but response is lost | pending file remains, next invocation re-exports, web upsert by `usageId` dedupes |
| pending delete succeeds but deletion checkpoint fails | invocation still succeeds based on the main checkpoint; next invocation may re-export, web upsert by `usageId` dedupes |
| malformed pending file exists | valid records still export; malformed file remains pending and emits a durable issue/status signal plus best-effort log |

## Non-Goals

- Do not aggregate usage by logical turn at write time.
- Do not route usage through `HostedRuntimeLog`.
- Do not create Cloudflare-owned pending usage storage.
- Do not add a second web run/commit protocol.
- Do not make usage export a precondition for the main assistant checkpoint.
- Do not add a broad export framework unless usage and runtime issues can share a tiny helper without hiding behavior.
- Do not add a separate deletion flag if `exported > 0` remains the exporter contract for acknowledged-and-deleted rows.

## Simplest Implementation Shape

1. Web schema hard cut:
   - drop `@@unique([turnId, attemptCount])`
   - add `providerRequestOrdinal Int @default(0) @map("provider_request_ordinal")`
   - add `@@unique([turnId, attemptCount, providerRequestOrdinal], map: "hosted_ai_usage_turn_attempt_provider_request_idx")`
   - keep `id` as `usageId`

2. Web importer:
   - upsert `HostedAiUsage` by `id: record.usageId`
   - persist normalized `providerRequestOrdinal`
   - add `providerRequestOrdinal` to immutable select/compare checks
   - keep immutable-field mismatch checks
   - if the response keeps both `recorded` and `usageIds`, validate that `recorded === usageIds.length` before runtime accepts it

3. Runtime:
   - add `drainHostedRuntimeUsageExport` near the workspace runner checkpoint path
   - call it only after the main checkpoint has succeeded
   - checkpoint again best-effort only when acknowledged pending files were deleted
   - ensure export or cleanup-checkpoint failure cannot fail already-checkpointed assistant work

4. Observability:
   - add a bounded structured runtime log event for export counts
   - keep logs best-effort
   - add a durable status/runtime-issue signal for stuck malformed pending usage records, because logs alone are lossy

5. Tests:
   - web accepts two rows with same `turnId + attemptCount` and different `providerRequestOrdinal`
   - web idempotently re-imports the same `usageId`
   - web rejects or idempotently handles duplicate same `turnId + attemptCount + providerRequestOrdinal`
   - runtime exports pending usage after successful checkpoint
   - runtime leaves pending usage when export fails
   - runtime follow-up checkpoints best-effort when export deletes files
   - runtime cleanup checkpoint failure does not fail already-checkpointed assistant work
   - runtime does not use logs as correctness state

## Open Review Questions

- Should runtime issues use the same post-checkpoint drain primitive, or stay separate until usage is fixed?
- Should `recorded` remain in the hosted usage export response, or should the contract hard-cut to acknowledged `usageIds` only?
- Does the stale hosted AI usage idempotency ledger row need to be closed before this plan becomes implementation work?

## Coordination Note

The current coordination ledger has a hosted AI usage idempotency row whose plan path appears stale. Historical completed plan text intentionally enforced one row per `turnId + attemptCount`, while this plan changes the invariant to one row per provider request. Before implementation, clear or update that stale row and merge ownership so only one lane edits `apps/web/prisma/schema.prisma`, `apps/web/src/lib/hosted-execution/usage.ts`, runtime-state usage parsing, assistant-runtime usage export, and coupled migrations/tests.

This document is a design stress-test plan and should not be treated as authority to edit overlapping runtime, schema, or importer files without coordination.

## Stress-Test Findings Folded In

Three GPT-5.5 high review agents stress-tested this plan for simpler long-term shape and lifecycle bugs. Accepted findings:

- schema/importer hard cut and runtime drain must be atomic
- nullable `providerRequestOrdinal` is ambiguous; use non-null default `0`
- preserve a semantic duplicate-metering backstop with `turnId + attemptCount + providerRequestOrdinal`
- runtime drain belongs in `workspace-runner`, not assistant phase code
- export and cleanup checkpoint are post-main-checkpoint cleanup; they must not fail already-checkpointed assistant work
- logs are visibility only; malformed stuck records need a durable signal
- use existing `runtime` log component with a single new event code rather than adding a new log component
