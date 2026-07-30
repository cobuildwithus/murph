# Finalize PR 1059 after the ReviewGPT round cap

Status: active
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

1. [ ] Merge current `main` normally and resolve every conflict from the
   current owner contracts and the PR's intended behavior.
2. [ ] Inspect the full current-base diff for obsolete or duplicated changes
   and keep only the smallest still-required implementation.
3. [ ] Run focused device-sync/Web/Cloudflare tests and direct source-scoped
   admission proof for every conflict-affected path.
4. [ ] Update the PR intent, architecture, verification, review-chain, and
   deployment-skew evidence for the exact reconciled head.
5. [ ] Push the candidate, reopen the draft PR, and run exact-head CI and
   ReviewGPT Round 6 concurrently.
6. [ ] Resolve any accepted finding, repeat affected focused proof, and require
   a final exact-head `PASS` plus green required checks before completion.

## Verification

- Pending conflict-resolution proof.
- Pending focused source-scoped Junction lifecycle and import-boundary tests.
- Pending exact-head CI.
- Pending ReviewGPT Round 6.
