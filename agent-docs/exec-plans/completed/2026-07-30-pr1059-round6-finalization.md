# Finalize PR 1059 after the ReviewGPT round cap

Status: completed
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- Reconcile the existing Junction source-scoped lifecycle fix with current
  `main` without weakening the reviewed admission, callback, import, or
  deployment boundaries.
- Preserve current-main behavior outside the PR's intentional security and
  device-sync changes.
- Use the user's explicit continuation authorization to run ReviewGPT Round 6
  on the exact final pushed head, require `PASS`, and finish the existing PR.

## Evidence

- The preserved task record says Round 6 was never started; the final recorded
  head is the post-Round-5 remediation candidate.
- The branch and remote branch still point to the same recorded head.
- Current `main` is hundreds of commits ahead and a synthetic merge reports
  content conflicts across durable docs, Web, Cloudflare, and tests.
- The PR is closed, unmerged, and draft, so no production mutation has occurred.

## Tasks

1. [x] Merge current `main` normally and resolve every conflict from the
   current owner contracts and the PR's intended behavior.
2. [x] Inspect the full current-base diff for obsolete or duplicated changes
   and keep only the smallest still-required implementation.
3. [x] Run focused device-sync/Web/Cloudflare tests and direct source-scoped
   admission proof for every conflict-affected path.
4. [x] Prepare the PR intent, architecture, verification, review-chain, and
   deployment-skew evidence for the exact reconciled head.
5. [x] Complete the parent final review and close this implementation plan
   before the final ReviewGPT gate.

## Post-plan merge gates

- Push the candidate and update/reopen the draft PR.
- Run exact-head CI and ReviewGPT Round 6 concurrently.
- Resolve any accepted finding, repeat affected focused proof, and require a
  final exact-head `PASS` plus green required checks before merge.

## Verification

- `git diff --check` passed with no unresolved conflict markers.
- Device-sync focused tests: 5 files, 432 tests passed.
- Web focused tests: 10 files, 254 tests passed.
- Cloudflare deploy-focused tests: 2 files, 88 tests passed.
- Device-sync, Web, and Cloudflare scoped typechecks passed.
- The merge exposed and the focused Web suite caught a source-attribution
  mismatch. The resolved boundary now keeps lifecycle source attribution for
  admission while using data-source attribution for receipts and signals.
- Pending exact-head CI.
- Pending ReviewGPT Round 6.
Completed: 2026-07-30
