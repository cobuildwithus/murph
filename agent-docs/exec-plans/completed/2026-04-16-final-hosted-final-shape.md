# Final hosted cleanup shape

Status: completed
Created: 2026-04-16
Updated: 2026-04-16

## Goal

- Land the remaining hosted cleanup so the repo matches the final greenfield shape: no rollout-only legacy reference dispatch path, outbox payloads prune once no web-owned retry work remains, the baseline migration already reflects the `ExecutionOutbox` hard cut, and missing per-run proxy tokens fail closed.

## Success criteria

- `apps/cloudflare` exposes only the canonical dispatch and status routes, with the legacy reference route removed from code, tests, and docs.
- `apps/web` no longer carries the stored-reference dispatch compatibility path or reference-payload parsing helpers in the hosted outbox runtime.
- Accepted outbox rows with `nextAttemptAt = null` summarize/prune payload JSON, and pruning keys off “no more web-owned retry work remains”.
- The baseline Prisma migration no longer defines `ExecutionOutboxStatus` or `ExecutionOutbox.status`, and the follow-up removal migration is deleted.
- Hosted docs and architecture text match the narrowed hosted surface.

## Scope

- `apps/cloudflare/src/{index.ts,runtime-platform.ts,worker-routes/shared.ts}`
- `apps/cloudflare/{README.md,DEPLOY.md}` plus affected tests
- `apps/web/src/lib/hosted-execution/{dispatch.ts,outbox.ts,outbox-payload.ts}`
- `apps/web/prisma/migrations/**` plus affected tests/docs
- `ARCHITECTURE.md` and hosted READMEs that still mention the removed compatibility seam

## Constraints

- Preserve unrelated dirty worktree edits and do not revert other active hosted lanes.
- Treat the supplied patch as behavioral intent, not an overwrite.
- Keep the cleanup aligned with the current final hosted model that already removed `ExecutionOutbox.status` from `schema.prisma`.

## Risks and mitigations

1. Risk: Active hosted lanes already modified nearby files.
   Mitigation: Reconcile current file state first, keep edits minimal, and avoid touching unrelated behavior.
2. Risk: Migration/test drift can leave the baseline tree inconsistent with `schema.prisma`.
   Mitigation: Update migration assertions and remove the now-redundant follow-up migration in the same change.
3. Risk: Outbox pruning can accidentally discard payloads that web still needs for retries.
   Mitigation: Prune only once `nextAttemptAt` is `null`, keep claim/retry state intact, and cover the boundary with focused tests.

## Verification

- Run targeted hosted web and Cloudflare tests that cover the changed route/outbox/migration behavior.
- Run typecheck for the touched hosted apps.
- If broader acceptance is required but blocked by unrelated branch state, document the blocker and the focused proof that was run instead.
Completed: 2026-04-16
