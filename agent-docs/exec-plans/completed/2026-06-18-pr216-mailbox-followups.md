# PR 216 Mailbox Follow-Up Fixes

## Goal

Resolve the accepted PR 216 review findings around hosted mailbox replay, retention, consume acknowledgements, and duplicate-reply suppression.

Success means:

- Replay-only conversation lag does not block AI-denied users or unrelated system work.
- Conversation mailbox data still has a hard expiry/retention bound.
- Failed consume acknowledgements schedule a near-term retry wake.
- Durable local conversation watermarks can advance server-side duplicate suppression without requiring replay coverage for every older server row.
- Redundant pending-input compaction state is removed.
- Runtime mailbox fetch remains a single cursor per lane after the local imported watermark.
- Retained-prefix recovery applies to conversation and system lanes.

## Constraints

- Keep web as owner of hosted mailbox facts, retention, reconciliation facts, and consumed watermarks.
- Keep the assistant runtime as owner of local import, reply, pending-input, and checkpoint effects.
- Do not add a new scheduler, queue, persisted owner, or broad compatibility abstraction.
- Preserve foreground conversation priority and fail-closed mailbox payload handling.

## Working Set

- `apps/web/src/lib/hosted-orchestration/runtime-reconciliation-facts.ts`
- `apps/web/src/lib/hosted-retention/cleanup.ts`
- `apps/web/src/lib/hosted-mailbox/store.ts`
- `apps/web/test/hosted-orchestration-reconciliation-facts.test.ts`
- `apps/web/test/hosted-retention-cleanup.test.ts`
- `apps/web/test/hosted-mailbox-store.test.ts`
- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/src/hosted-runtime/mailbox-import.ts`
- `packages/assistant-runtime/src/hosted-runtime/pending-assistant-input.ts`
- `packages/assistant-runtime/src/hosted-runtime/pending-input-index.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts` test fixtures only
- `packages/assistant-runtime/test/hosted-runtime-workspace-runner.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-mailbox-import.test.ts`

## Verification Plan

- Focused hosted web tests for reconciliation, retention, and mailbox store behavior.
- Focused assistant-runtime tests for mailbox import, pending input compaction, and consume acknowledgement behavior.
- `apps/web` and `packages/assistant-runtime` typechecks.
- Required local completion audits for security/privacy, coverage, and deep runtime edge cases.
- PR ReviewGPT loop after pushing the final head.

## Progress

- Registered the plan and coordination-ledger row.
- Patched replay-aware orchestration AI gating and quota-notice lookup.
- Restored unconditional mailbox expiry/retention deletion.
- Added failed consume-ack retry wake behavior.
- Collapsed pending-input compaction callers onto the single compaction primitive.
- Simplified consume ack to the durable local conversation watermark after pending/reply gates.
- Deleted the replay-prefix/fresh-tail mailbox fetch cursor path; runtime fetch now always starts after local import and carries the response consumed floor once.
- Generalized retained-floor consumed repair and importer first-retained-row fast-forward to the system lane.
- Unified fetch-time payload expiry with cleanup expiry for explicit `expiresAt` and 30-day age retention.
- Preserved explicit assistant retry backoff from pending-input wake synthesis while keeping immediate wake for late-arriving foreground work.
- Removed the ack full-history pending-input scan; consume ack now uses the same bounded pending-input compaction as normal runtime work.
- Applied the mailbox live-row predicate to fetch pages, max high-water reads, retained-floor repair, AI-gated system lookup, quota-notice conversation lookup, and sidecar payload reads.
- Focused hosted web tests passed: `hosted-mailbox-store`, `hosted-runtime-internal-routes`, reconciliation, retention cleanup, runtime usage decision.
- Focused assistant-runtime tests passed: mailbox import, workspace runner, pending input, mailbox payloads.
- Additional affected assistant-runtime suites passed: workspace entrypoint, workspace assistant phase, diagnostics, invocation bridge, mailbox checkpoint.
- `apps/web typecheck` passed.
- `packages/assistant-runtime typecheck` and `pnpm test:diff` are blocked only by existing assistant-engine voice-memo/media type errors outside this diff; diff guards before that passed.
- `git diff --check` and privacy identifier/secret scan passed.
- Next: complete local audits, commit with `scripts/finish-task`, push, and PR review loop.
Status: completed
Updated: 2026-06-18
Completed: 2026-06-18
