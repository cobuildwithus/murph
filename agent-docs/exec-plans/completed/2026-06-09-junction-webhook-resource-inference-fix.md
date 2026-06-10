Goal (incl. success criteria):
- Fix the June 8 production incident where enriched Junction webhooks silently dropped WHOOP sleep imports and starved the scheduled full-resource reconcile.
- Success means: enriched `daily.data.sleep.created` payloads carrying unknown record-level resource discriminators still build proper `sleep` jobs with direct-import payloads; unconfigured webhook resource jobs fall back to the event-type resource or skip observably via the skipped-resource metadata seam; webhook-driven job completions never push the scheduled reconcile out indefinitely; a permanent regression test pins all of this.

Constraints/Assumptions:
- Minimal diff; no refactors beyond the fix. No `as any`. Public entrypoints only.
- Avoid PR #84 seams (service.ts failure logging, assistant-runtime maintenance.ts).
- PR #73 already made the default reconcile interval hourly; this fixes the mechanism, not the constant.

Key decisions:
- Resource inference guard: payload-derived resource overrides the event-type resource only when it normalizes to a known/allowed Junction resource (allowed summary + allowed/known timeseries names).
- Reconcile starvation: webhook resource-job completions clamp `nextReconcileAt` to `min(existing schedule, now + interval)` instead of always `now + interval`. Clamp (not omission) because `markSyncSucceeded` is also the seam that seeds the schedule for accounts whose link callback never completed (`nextReconcileAt` starts null from the connection seed).
- Unresolvable unconfigured webhook resources keep the skip but surface through `withJunctionSkippedResourceMetadata` so the drop lands in sync diagnostics metadata.

State:
- Done.

Done:
- Root cause confirmed against junction.ts:4549-4575, :4258, :1129-1137, :720-722, :1149-1151 and store/sync-state.ts:55-57.
- Implemented all three fixes (inference guard, observable event-type fallback, min-clamp reconcile scheduling) and added the permanent regression suite in junction-webhooks.test.ts.
- Verified: junction-webhooks + junction-provider tests pass (119); full workspace suite green except the unrelated worktree-naming path test (worktree not named murph-*); workspace typecheck clean.

Now:
- finish-task commit; main session reviews, pushes, opens PR.

Next:
- Promote the additive-ingestion refactor plan once this merges.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/device-syncd/src/providers/junction.ts
- packages/device-syncd/test/junction-webhooks.test.ts
- pnpm --filter @murphai/device-syncd test / typecheck
Status: completed
Updated: 2026-06-09
Completed: 2026-06-09
