# Hosted Usage Direct Recording

## Goal

Remove the hosted assistant pending-usage file/export lifecycle and record hosted AI usage directly to the web-owned usage ledger from the provider-result boundary.

Success criteria:

- Hosted AI usage is recorded through one narrow web callback when the provider returns normalized usage.
- `apps/web` remains the only durable hosted usage ledger, keyed by `usageId`.
- `assistant-engine` does not know about web routes, Cloudflare transport, checkpoint storage, or billing internals.
- No local pending usage files are written, snapshotted, exported, deleted, or cleanup-checkpointed.
- Usage recording failures are metadata-only operational warnings and do not fail assistant turns.
- Existing hosted usage gates, allowance accounting, billing integration, account export/deletion, and dashboard usage-limit behavior keep working.

## Constraints And Assumptions

- Priority is clean, simple, long-term maintainable architecture with minimal moving parts.
- Accept the tradeoff that exact accounting is best-effort if the usage callback fails after provider success.
- Usage accounting is tied to provider spend, not workspace checkpoint success.
- Do not add a generic HTTP interceptor around raw OpenAI/Codex transport. Intercept at Murph's normalized provider-result boundary where usage metadata is already structured and sanitized.
- Preserve `AssistantUsageRecord` or move it to a neutral contract owner; do not keep it as a pending-file-specific runtime-state API.
- Do not reintroduce Cloudflare-owned usage storage.
- Do not let usage recording failures poison assistant continuity.
- Do not log prompts, responses, transcripts, raw provider bodies, headers, API keys, full local paths, or user identifiers.

## Proposed Architecture

Current shape:

```text
provider response
  -> assistant-engine builds usage record
  -> runtime-state writes local pending usage file
  -> hosted workspace checkpoint
  -> assistant-runtime drains pending files
  -> Cloudflare calls web usage route
  -> web upserts HostedAiUsage by usageId
  -> assistant-runtime deletes pending file
  -> optional cleanup checkpoint
```

Target shape:

```text
provider response
  -> assistant-engine builds usage record
  -> injected hosted usage recorder calls web usage route
  -> web upserts HostedAiUsage by usageId
```

The core seam is an optional injected recorder, not a file store:

```ts
interface AssistantUsageRecorder {
  recordUsage(record: AssistantUsageRecord): Promise<void>
}
```

`assistant-engine` should depend only on that neutral recorder interface plus the usage record contract. Hosted runtime supplies the recorder. Local/non-hosted execution can omit it.

## Key Decisions

- Use the provider-result boundary, not raw HTTP interception.
  - Raw interception is brittle and provider-specific.
  - Provider-result usage is already normalized and associated with turn/session/attempt attribution.

- Keep web idempotency as the correctness boundary.
  - `HostedAiUsage.id` remains `usageId`.
  - Duplicate callback attempts use the existing upsert and immutable-field comparison.
  - Allowance accounting remains guarded by `allowanceAccountedAt`.

- Remove pending files rather than only removing cleanup checkpoints.
  - Pending files create a second lifecycle: file write, snapshot inclusion, export, delete, malformed-file issue recording, recovery checkpointing.
  - That lifecycle exists only to get usage to web later; direct recording removes the reason for it.

- Keep the existing web usage route initially.
  - The route is already the narrow write boundary from hosted runtime to web.
  - The simplification is removing the local outbox/export lifecycle, not merging usage into workspace checkpointing.

## Implementation Steps

1. Define the neutral usage recorder seam.
   - Add an optional recorder to the assistant execution context or service dependency surface.
   - Keep the recorder typed in terms of `AssistantUsageRecord`.
   - Ensure local execution has no recorder by default.

2. Replace pending-file writes at provider-result call sites.
   - Update `persistPendingAssistantUsageEvent` or replace it with `recordAssistantUsageEvent`.
   - Build the same sanitized usage record currently written to disk.
   - If no hosted member id or no provider usage exists, keep the current no-op behavior.
   - If a recorder exists, call it best-effort.
   - On recorder failure, emit a redacted metadata-only warning/diagnostic and continue.

3. Wire hosted runtime to web usage recording.
   - Reuse the existing Cloudflare hosted web-control transport and `/api/internal/hosted-execution/usage/record` route.
   - Preserve trusted user binding and web-side `trustedUserId` checks.
   - Keep batching optional; a per-record call is acceptable for the first simplification pass unless provider loops produce material fanout.

4. Delete assistant-runtime pending usage export.
   - Remove `exportHostedPendingAssistantUsage`.
   - Remove post-checkpoint usage drain from `workspace-runner`.
   - Remove assistant-failure usage record recovery.
   - Remove cleanup checkpoint helper and redacted status fields tied only to usage cleanup/export.

5. Delete runtime-state pending usage file storage.
   - Remove pending usage path fields, local-state descriptors, hosted hot-bundle inclusion, write/list/delete helpers, and pending-file tests.
   - Keep or relocate the pure usage record schema/parser/`createAssistantUsageId` if web and assistant-engine still need it.

6. Preserve web ledger behavior.
   - Keep `HostedAiUsage` and `HostedAiUsagePeriod`.
   - Keep usage import upsert by `usageId`.
   - Keep immutable-field comparison.
   - Keep allowance accounting and usage gate behavior.
   - Keep hosted account export/deletion coverage for usage rows.

7. Remove obsolete route/port only after the new recorder path is stable.
   - If the existing route remains the recorder target, keep it.
   - Remove only old names and ports that imply post-checkpoint export from pending files.
   - Do not keep both "pending export" and "direct recorder" as parallel normal paths.

8. Update tests.
   - Replace pending-file write tests with recorder tests.
   - Add assistant-engine tests proving recorder is called for successful and terminal-failed provider outcomes when usage exists.
   - Add tests proving recorder failure does not fail the assistant turn.
   - Keep web usage import, allowance, Stripe metering, usage gate, Linq quota, dashboard banner, and account deletion/export tests.
   - Remove assistant-runtime pending export, malformed pending file, cleanup checkpoint, and runtime-state pending path tests.

9. Update docs.
   - Update architecture/runtime docs to say hosted AI usage is web-owned and recorded directly from normalized provider usage.
   - Remove language that pending usage files are durable retry state.
   - Update testing map if verification surfaces change.

## Stress-Test Findings

Five review agents stress-tested the options.

Important conclusions:

- Web's `usageId` upsert and allowance guards are enough for duplicate callback safety.
- Memory-only usage carried through workspace checkpoints risks losing usage if a runner dies before checkpoint assembly, and it can make checkpoint contracts muddy.
- Folding usage into workspace checkpoints risks making usage validation poison workspace persistence unless carefully isolated.
- Direct recording at the provider-result boundary is simpler than checkpoint-carried usage, as long as it is injected as a neutral recorder and remains best-effort.
- The hosted usage ledger/gate must stay; only the local pending usage lifecycle is removable.

## Files Likely Touched

- `packages/assistant-engine/src/assistant/service-usage.ts`
- `packages/assistant-engine/src/assistant/local-service.ts`
- `packages/assistant-engine/src/assistant/notification-turn.ts`
- `packages/assistant-engine/src/assistant/execution-context.ts`
- `packages/assistant-engine/test/**`
- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/src/hosted-runtime/platform.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts`
- `packages/assistant-runtime/src/hosted-runtime/usage.ts`
- `packages/assistant-runtime/test/**`
- `packages/runtime-state/src/assistant-usage.ts`
- `packages/runtime-state/src/assistant-state.ts`
- `packages/runtime-state/src/assistant-local-state-descriptors.ts`
- `packages/runtime-state/src/hosted-bundles.ts`
- `packages/runtime-state/test/**`
- `apps/cloudflare/src/runtime-platform.ts`
- `apps/cloudflare/src/runner-outbound/shared-web-control-policy.ts`
- `apps/web/src/lib/hosted-execution/usage.ts`
- `apps/web/test/hosted-execution-usage-route.test.ts`
- `agent-docs/**`

## Verification Plan

- `pnpm typecheck`
- Truthful `pnpm test:diff <touched paths>` if it covers the touched owners.
- Otherwise:
  - `pnpm --dir packages/assistant-engine test:coverage`
  - `pnpm --dir packages/assistant-runtime test:coverage`
  - `pnpm --dir packages/runtime-state test:coverage`
  - `pnpm --dir apps/cloudflare verify`
  - `pnpm --dir apps/web verify`
- Focused tests for:
  - recorder success
  - recorder failure best-effort behavior
  - no pending usage files created
  - no post-checkpoint usage record
  - web idempotent duplicate usage import
  - allowance accounting not double-counted

## Open Questions

- Should the pure `AssistantUsageRecord` contract move from `runtime-state` to `contracts`, `hosted-execution`, or `assistant-engine` once pending files are gone?
- Should direct recording call web once per provider result or batch within one provider loop?
- Should recorder failures create a lightweight hosted runtime issue, or is a redacted runtime log enough?

## Current Status

- Implemented direct `AssistantUsageRecorder` injection through the hosted execution context.
- Reused the hosted `usageRecordPort` transport as the recorder adapter.
- Removed local pending usage file helpers, hosted pending usage export, cleanup checkpointing, runtime usage-export log event, and pending usage hot/full-bundle inclusion.
- Focused tests and package/root typecheck pass.
- `pnpm test:diff` currently fails in unrelated repo-tool coverage because the dirty worktree has a separate Cloudflare hosted-local E2E script entry.
Status: completed
Updated: 2026-05-06
Completed: 2026-05-06
