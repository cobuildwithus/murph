# Prove device-sync recovery through the production snapshot boundary

Status: completed
Created: 2026-08-14
Updated: 2026-08-14

## Goal

- Resolve the accepted ReviewGPT round-2 finding from PR #1806 by removing the
  test-owned legacy snapshot semantics from the incident regression and proving
  cold recovery at the smallest production-faithful owner boundary. PR #1806
  merged at its prior head while the correction was in flight, so the verified
  correction continues in focused follow-up PR #1812.

## Success criteria

- The proof cannot restore `.runtime/operations/device-sync/state.sqlite` from
  the checkpoint used for cold replacement.
- Snapshot omission and recovery are owned either by the existing production v2
  checkpoint/restore path or by a smaller composition of existing owner proofs.
- Canonical event/item identity, completion-fenced cadence, bounded replay, and
  terminal quiescence remain directly executable claims.
- Exact request/checkpoint counts remain documented only when observed through
  the authoritative boundary.
- No production source, export, service, queue, state owner, compatibility path,
  provider-effect journal, snapshot protocol, or new testkit is added.

## Retrospective decision

- Round 1 replaced the owner with a synthetic state machine. Round 2 reached the
  real runtime entrypoint but still replaced the production v2 snapshot owner
  with a legacy full-vault bundle helper that retained machine-local SQLite.
- Preserve all deletion-first remediation. Prefer direct reuse of the current v2
  snapshot and cold-restore owners; if that requires new architecture, split the
  contract across existing owner proofs and reduce the cross-owner scenario.
- The deferred production-like replay/load guard remains out of scope.

## Tasks

1. [x] Verify ReviewGPT's snapshot-owner finding against production code.
2. [x] Have ReviewGPT author the smallest production-faithful correction.
3. [x] Inspect the patch and run focused owner tests, typechecks, and docs drift.
4. [x] Commit, push, and run the next required full ReviewGPT round with CI.
5. [x] Complete parent review and prepare the guarded merge and worktree retirement.

## Verification

- ReviewGPT round 2: `ROUND_OUTCOME: RETROSPECTIVE_REQUIRED` at
  `c480ce5128ff03d4cf2fcbe1b222d66ba3c203dd`.
- PR #1806 merged externally at that reviewed head before the accepted
  correction was pushed; follow-up PR #1812 owns the correction.
- Static inspection confirmed the changed test's legacy bundle snapshots the
  whole vault, while production v2 archive planning excludes the machine-local
  device-sync subtree and restores through a different owner branch.
- The corrected proof seeds the committed clean input through the production v2
  checkpoint bridge, observes the live machine-local SQLite store at the failed
  post-pull v2 snapshot boundary, proves that archive omits the store, and cold
  restores the exact last committed v2 ref through the production restore owner.
- Focused owner regression, Web admission regressions, assistant-runtime
  typecheck, docs drift, and `git diff --check` pass.
- PR #1812 preliminary specialists: `SPECIALIST_OUTCOME: FINDINGS` at
  `0b692be223aa77277805834e3701d514aacff48c`. The accepted coverage finding
  preserves the authoritative version-1 seed workspace and compares the complete
  restored v2 ref. The downloaded test-only patch passed cached-index apply-check;
  the parent correction also shifted the failed checkpoint event version that
  the unexecuted artifact omitted. Focused proof passes after correction.
- PR #1812 final ReviewGPT round 1: `ROUND_OUTCOME: PASS` at the same head. The
  next final round verifies the combined specialist remediation delta.
- PR #1812 final ReviewGPT round 2: `ROUND_OUTCOME: PASS` at
  `49f271710ddbf2394b0ac7f6212c8266029a1a91` with no findings.
- Parent final review re-read the complete test and documentation diff and found
  no remaining proof gap, unrelated architecture, or unresolved finding.
Completed: 2026-08-14
