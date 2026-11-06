# Reduce foreground reply wake latency

Status: completed
Created: 2026-09-12
Updated: 2026-09-12

## Outcome and invariant

Outcome: finish successful foreground replies without repeatedly scanning
retained delivery history under the shared assistant write lock.
Reaches: synchronous and deferred hosted replies, legacy route migration,
background recovery, and idle snapshot maintenance.
Proof: composed delivery/scheduling tests plus real route-state and residue tests.
Exact route claims, provider delivery, receipt authority, and replay suppression
remain unchanged.

## Owner and evidence

The hosted assistant phase called full route maintenance after every successful
foreground pass. The engine implementation inventoried every retained outbox
record under the shared assistant runtime write lock. This made post-reply work
grow with unrelated history. Exact foreground route reads already reconcile their
bounded pending receipt; idle snapshot residue pruning already calls the full
maintenance owner.

The regression failed before the change: completed migration still read malformed
unrelated outbox history. With migration-only maintenance it reads the existing
marker and returns, while ordinary background maintenance still detects malformed
history and fails closed. The same test proves partial migration yields without
publishing the marker, completes on retry, and preserves legacy consumption.

## Design

Add one optional migration-only mode to the existing engine maintenance operation.
Select it for successful, progressed hosted foreground results. First-use legacy
migration remains after delivery, before the next attempt. Once its marker is
complete, foreground completion performs constant directory setup and one marker
read under the existing lock, without a history inventory. Background/no-progress
reconciliation and idle pruning retain full maintenance in their current owners.

No network calls, databases, queues, caches, timers, dependencies, schemas, or
persisted state are added. Managed automation setup, member actions, delivery
callbacks, prompt assembly, and model/tool behavior stay in their existing owners.
Parent review replaced an initial unconditional skip with migration-only work to
preserve first-use anchored reply migration before a following unanchored turn.

## Product UX and verification

Patch journey verdict: Ready for the source change. Deferred and direct successful
replies preserve delivery-before-maintenance ordering. Older workspaces retain
cooperative migration and receipt evidence. Background/no-progress recovery and
idle pruning retain full reconciliation. Live end-to-end latency improvement is
not yet measured; this source result does not close that separate evidence gap.

- Red/green regression: completed migration skips unrelated outbox history.
- Passed: 131 hosted assistant delivery and scheduling tests.
- Passed: 68 real route-state and runtime-residue tests.
- Passed: assistant-engine, assistant-runtime, and web typechecks.
- Passed: 10 changelog page tests after web artifact generation.
- The documented web-relative changelog test command found no tests; the
  repository-root equivalent passed after generation. Existing Frog entry
  `20260911184822-documented-changelog-test` already owns this friction.
- Focused live-model proof is not applicable: this changes maintenance timing
  after delivery, without changing provider input or model-dependent behavior.
- Passed: `pnpm complexity:diff`; unchanged hotspot debt in both affected source
  files. Existing large orchestration and pruning functions were reviewed; this
  change remains in the small existing maintenance boundary.
- Parent candidate review and privacy readback passed. Scoped local commit closes
  this implementation plan; no PR, CI, or deployment is claimed.

Commands: `pnpm exec vitest run --config packages/assistant-runtime/vitest.config.ts
packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase-delivery.test.ts
packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase-scheduling.test.ts
--no-coverage`; `pnpm exec vitest run --config packages/assistant-engine/vitest.config.ts
packages/assistant-engine/test/assistant-auto-reply-route-state.test.ts
packages/assistant-engine/test/assistant-runtime-residue.test.ts --no-coverage`;
`pnpm --dir packages/assistant-engine typecheck`;
`pnpm --dir packages/assistant-runtime typecheck`; `pnpm --dir apps/web typecheck`;
`pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage
apps/web/test/changelog-page.test.tsx`.

## Completion boundary

Production wake transport attribution and post-deploy cold/warm measurements
remain separate evidence gaps. Removing repeated history work does not prove
that every observed wake timeout has this cause. This task has not changed
production state or sent member messages. Deployment and exact-head CI are not
local test results.
Completed: 2026-09-12
