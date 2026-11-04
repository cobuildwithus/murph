# Durable meal thumbnail upload ownership

Status: completed
Created: 2026-11-04
Updated: 2026-11-04

## Goal and protected invariants

Fix the accepted PR review finding: an unacknowledged thumbnail PUT must never
leave an unlimited-lifetime object without a durable cleanup pointer. Preserve
full-photo expiry, canonical rollback and receipt recovery, and terminal media
retirement. Keep production read-only and leave changes uncommitted for parent
review.

## Design decision

Use the existing checkpoint as the upload owner. Meal thumbnail bytes already
remain in canonical receipts and snapshots. Prepare an additive `pendingUpload`
catalogue entry without remote media effects. After the snapshot is accepted,
register its meal lifetime, then PUT the bytes. Restore also resumes pending
uploads after all committed receipts replay and current holders are checked.
Preserve pending intent on any failure; receipt replay reconstructs it. The accepted snapshot retains the
pending marker, so a cold restore can retry the same identity even after a lost
response. Registration precedes PUT to prevent a partial upload expiring under
the provisional 65-minute orphan lifetime. Successful restore joins the existing
startup checkpoint obligation to save completion, avoiding repeated uploads on
clean wakes. Older catalogues conservatively retry once; missing markers after
an older runner writes remain recoverable. Snapshot reconciliation retains
cleanup pointers until deletion is acknowledged.

Keep operation-based filenames to avoid existing terminal identities from the
original incident. Do not relax retirement: a lost receipt-upload response does
not prove the receipt was never stored. Provisional PUT plus later promotion
would require additional recovery for already-retired provisional objects.

## Tasks and proof

1. Prove the new lost-response case fails on the parent head: complete remote
   storage, reject its response, rollback, reconcile, retry, delete and prune.
2. Move meal delivery effects after accepted checkpoint, preserve pending intent
   in the existing catalogue, and reconstruct it from receipt replay.
3. Cover both failure shapes, stored-but-unacknowledged receipts, cold recovery
   before first registration, partial/lost uploads, and rejected checkpoints.
4. Run focused artifact/core/bridge suites and core/runtime/Web typechecks,
   changelog checks, complexity and documentation checks. Review the diff.

## Deployment and risks

Runner only. Existing Web registration, upload admission and retirement APIs
are unchanged; no schema migration or Temporal deployment. Older runner rollback
may ignore the new pending marker and delay thumbnail delivery until rollforward.
Canonical bytes and deletion pointers remain compatible. Older catalogues can
cause one extra upload per live thumbnail; the next checkpoint saves completion.
No new alarm or wake path is introduced. Parent owns shipping.

## Verification

Before the source change, the new warm and restored lost-PUT-response cases
both failed on dd811e73e0: final media-store size was one, expected zero. Both
receipt-failure cases passed. After correction:

- Runtime artifact suite: 33 passed, including warm/cold receipt failure,
  stored receipt with lost response, lost PUT/registration response, partial PUT,
  receipt-only recovery after two hours, older-writer compatibility, repeated
  cold starts without repeated uploads, and final deletion of the entire store.
- Snapshot bridge: 122 passed, including rejected/lost checkpoint responses,
  accepted checkpoint before registration/PUT, pending intent in the archive,
  lost PUT response and successful retry, and meal deletion.
- Receipt entrypoint, restore preparation and cold-ingest regression suites:
  30 passed. All five runtime suites passed together (185 tests).
- Core meal-photo maintenance: 4 passed. Changelog page: 4 passed.
- Core, assistant-runtime and Web typechecks passed. Runtime typecheck was
  repeated after the final test assertion; it passed.
- Changelog generation passed. No changelog fragment changed in this follow-up.
- `pnpm complexity:diff` passed after removing unnecessary optional checkpoint
  branches and repeated thumbnail-kind checks. Complexity debt did not increase;
  snapshot construction debt decreased by one. Final diff and documentation
  checks follow.

Commands:

```sh
pnpm exec vitest run --config packages/assistant-runtime/vitest.config.ts --no-coverage packages/assistant-runtime/test/hosted-runtime-artifacts.test.ts packages/assistant-runtime/test/hosted-invocation-bridge.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint-receipts.test.ts packages/assistant-runtime/test/hosted-workspace-restore-preparation.test.ts packages/assistant-runtime/test/hosted-runtime-cold-ingests.test.ts
pnpm exec vitest run --config packages/core/vitest.config.ts --no-coverage packages/core/test/meal-photo-maintenance.test.ts
pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/changelog-page.test.tsx
pnpm --dir packages/core typecheck
pnpm --dir packages/assistant-runtime typecheck
pnpm --dir apps/web typecheck
pnpm --dir apps/web changelog:generate
pnpm complexity:diff
git diff --check
bash scripts/check-agent-docs-drift.sh
```

## Review and handoff

Product UX: Ready for parent review. Failed receipts preserve original bytes;
expired originals retire in canonical writes independently of delivery success.
Committed thumbnails recover from both receipts and snapshots, remain available
while the meal exists, and disappear with meal deletion. Stale deletion pointers
never authorize another upload. No full-photo deadline or retention wait changed.

The added persistent state is one optional boolean in the existing encrypted
media catalogue. It is an operation marker, not canonical meal truth. The restore
completion flag is transient and folds into existing startup checkpoint handling.
No dependency, server command, schema migration, quarantine or scheduler was added.

Review considered interrupted registration, partial PUT, lost replies, all-receipt
replay before effects, rejected checkpoints, old catalogue readers, terminal
retirement, deletion acknowledgement, and avoiding repeated cold-start effects.
Existing untracked objects from earlier releases cannot be discovered from a
missing catalogue pointer; this change does not claim retroactive orphan repair.

No production mutation, commit, amendment, push, or PR change. Parent owns the
next ReviewGPT round, CI, and deployment. All requested local checks ran. No new repository-actionable tooling friction
required a Frog entry.

Completed: 2026-11-04
