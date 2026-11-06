# Photo producer checkpoint safety corrections

Status: completed
Created: 2026-11-06
Updated: 2026-11-06

## Outcome and scope

Outcome: preserve recoverable photos through rejected checkpoints, enforce photo
ownership, keep unprovable files inline, and bound dedicated upload retries.
Reaches: shell meal deletion, public JSONL secondary references, measurement
attachments, idle delivery, checkpoint acceptance, and cold recovery.
Proof: synthetic regressions through canonical mutations, the real checkpoint
bridge and archive inventory, tar restore, and the existing media-store double.

The task is limited to four reviewed findings on the held draft branch. Keep the
current checkout and branch; make one new local commit, with no amend or push.
No production access, messaging, deployment, or remote PR mutation is involved.
The test updates crossed the repository's ten-file plan gate, so this record
captures the supplied design and completion evidence in the same scoped commit.

## Owners and decisions

- Reconciliation persists `retirementPending` in the existing media catalogue
  and fences the ID in the existing uncommitted-intent set. Snapshot acceptance
  releases it; a later publication deletes the object. Restored markers prove
  acceptance. Pending cleanup and other media families keep their existing owners.
- Candidate discovery accepts only the raw directory's own event lifetime.
  Meal IDs and measurement event IDs retain their canonical owner mapping.
- Existing manifest-denial classification makes new admission ineligible;
  cancellation still propagates. Doubt leaves bytes inline without new intent.
- The catalogue stores `uploadAttempts`, updated with the attempt cursor. Only
  pending entries below five attempts arm dedicated wakes through both idle
  maintenance and snapshot publication; ordinary idle passes
  still try exhausted entries. Exact-identity discovery and receipt replay retain
  the counter and retirement marker rather than resetting durable operations.

No new service, dependency, canonical product state, or upload queue is introduced.
The shared parser accepts the optional fields and validates their types. Rejection
and ambiguous checkpoint responses retain the fence; deletion failures retain
cleanup pointers. Existing legacy descriptors remain readable.

## Work and proof

- [x] Reproduce the four findings: all six new checkpoint cases fail against the
  original source (exit 1), at early deletion, secondary ownership, invalid manifest,
  or absent attempt persistence.
- [x] Implement the bounded corrections and update the architecture owner.
- [x] Prove warm rejected-checkpoint recovery of full and thumbnail bytes, then
  acceptance and later purge, including restart before purge.
- [x] Prove both secondary-reference cases through `event import-jsonl --apply`.
- [x] Prove malformed source `manifest.json`, its photo and an unrelated change
  survive checkpoint and cold restore with no new intent.
- [x] Prove five permanent upload timeouts stop checkpoint wakes, a sixth ordinary
  idle pass still tries, and inline bytes and attempts survive cold restore.
  The composed idle-to-checkpoint proof also fails without the idle wake guard
  (exit 1) and passes with it (exit 0).
- [x] Prove receipt replay preserves the counter for a matching pending thumbnail.
- [x] Update older cleanup tests to accept the tombstone checkpoint before purge.
- [x] Complete required full suites and final diff review; final exits are below.
- [x] Close this record with the single scoped local commit; no amend or push.

## Verification

Focused checkpoint regressions: 6 passed, exit 0. Maintenance: 35 passed, exit 0.
Artifact/preservation: 60 passed, exit 0. Cold-ingest: 10 passed, exit 0.

Full lanes use `--maxWorkers=2` (final assistant-runtime rerun uses 4):

| Lane | Command | Result |
| --- | --- | --- |
| Assistant runtime | `pnpm exec vitest run --config packages/assistant-runtime/vitest.config.ts --maxWorkers=4 --no-coverage` | 4,170 passed, 7 skipped; final exit 0. Initial exit 1 from 19 immediate-pruning test expectations; corrected and full suite rerun. |
| Runtime state | `pnpm --dir packages/runtime-state test --maxWorkers=2` | 291 passed, 19 skipped; exit 0. |
| Core | `pnpm --dir packages/core test --maxWorkers=2` | 1,092 passed, 1 skipped; exit 0. |
| Assistant engine | `pnpm --dir packages/assistant-engine test --maxWorkers=2` | 6,084 passed, 782 skipped; exit 0. |
| Cloudflare | `pnpm --dir apps/cloudflare test:node:workspace --maxWorkers=2` | 4,649 passed, 5 skipped; exit 0. |
| Workspace types | `pnpm typecheck` | Exit 0 after correcting four nullable test-result assertions (initial exit 1). |
| Complexity | `pnpm complexity:diff` | Exit 0; media-references maximum 20, no complexity debt. Existing idle and snapshot hotspots unchanged. |

Each lane captures `EXIT=$?` with shell pipe failure propagation. Synthetic
transport doubles prove checkpoint ordering and bytes; no live R2 claim is made.
Product walkthrough: Ready for the four repaired recovery paths. No new member
feature or presentation is added. Changelog remains with the held producer PR;
this local correction does not announce unshipped work. Remote review and CI
publication are outside the explicit no-push boundary.

Final review: all edits are scoped to the four findings and their composed proof.
No dependency, canonical schema, prompt or provider-input change. Added-content
identifier scan and `git diff --check` passed. No new repository friction entry
was needed. The known concurrent-device-import flake did not occur.
Completed: 2026-11-06
