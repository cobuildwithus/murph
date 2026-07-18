# PR 764 conflict resolution and ReviewGPT round 4

Status: completed
Created: 2026-07-18
Updated: 2026-07-18

## Goal

- Reconcile PR #764 with current `main` without weakening its narrow
  generated-delivery ownership boundary, verify the prior remediation delta,
  and obtain one valid ReviewGPT correction round on the exact pushed head.

## Success criteria

- The PR branch contains current `origin/main` through an ordinary merge and
  has no remaining merge conflicts.
- Manual resolutions preserve current-main runner-bundle policy and the PR's
  exact flat runtime-owned generated-delivery contract.
- Focused tests plus the repo-required verification lane pass on the resolved
  head, or any unrelated failure is proved against current `main`.
- The parent review finds no unjustified owner, state machine, registry,
  compatibility path, or false retry guarantee in the prior remediation.
- ReviewGPT round 4 is valid, completes in the guarded PR lane, and every
  finding is triaged; accepted findings are fixed and reverified.

## Scope

- In scope: PR #764 conflict resolution, directly affected source/tests/docs,
  current-main runner-bundle ratchet reconciliation, exact-head verification,
  PR body refresh, CI, and one new ReviewGPT round.
- Out of scope: redesigning generated delivery around a new durable identity,
  adding lifecycle state or reconciliation machinery, unrelated current-main
  regressions, production deploy, and PR merge unless separately requested.

## Constraints

- Technical constraints: preserve phase-one reader compatibility and the
  attempt-scoped limitation already documented; cleanup may own only direct
  files under the exact runtime directory after trusted quiescent inventory.
- Product/process constraints: use ReviewGPT as the sole cross-cutting gate,
  start it immediately after the resolved exact head is pushed, run CI in
  parallel, and preserve the immutable first-reviewed head.

## Risks and mitigations

1. Risk: resolving the bundle budget conflict to a stale exact byte ratchet.
   Mitigation: measure the merged runner bundle and preserve current-main's
   baseline, tolerance, and explicit headroom rather than either stale side
   mechanically.
2. Risk: overstating retry stability from the tool-call id.
   Mitigation: inspect the real new-provider-call recovery path and retain the
   explicit attempt-scoped limitation rather than adding speculative state.
3. Risk: base changes accidentally widen the PR patch or invalidate review
   lineage.
   Mitigation: preserve the first-reviewed head as an ancestor, compare
   base-to-head shape after merge, and package round 4 with the previous valid
   substantive head.

## Tasks

1. Reconstruct PR, review, CI, worktree, and first-head lineage.
2. Audit the prior remediation and its tests against current owner contracts.
3. Merge current `origin/main` and resolve the three known conflicts minimally.
4. Run focused and required verification, then parent final review.
5. Close this plan in a scoped commit, push, refresh the PR intent contract,
   and start CI plus ReviewGPT round 4 on the exact head.
6. Triage the round and complete any required remediation loop.

## Decisions

- Continue with the existing attempt-scoped identity limitation; a logical
  send identity that survives a replacement provider call would require a new
  durable fact or coalescing rule that the current product contract does not
  justify.
- Serialize `send-vault-file` through the existing dynamic-tool chain. This
  keeps the already-owned one-media-per-hosted-dispatch invariant explicit and
  avoids a second lock or queue.
- Require generated-delivery sends to carry the provider's semantic tool-call
  id. Ordinary vault-file sends remain compatible; silently inventing an id
  for generated content would alias distinct same-turn sends.
- Use one filesystem ownership transition: atomically hard-link the friendly
  source to the deterministic target, verify both links identify the captured
  inode, unlink the friendly source, then reuse ordinary single-link adoption
  to apply mode `0600`. This is no-clobber, crash-recoverable, and introduces no
  registry or lifecycle state.
- Fail closed when an active generated artifact has multiple links. For an
  orphaned artifact, cleanup may unlink only the exact runtime-owned link and
  must not chmod or delete another path sharing the inode.
- Keep quarantine as the existing two-pass cleanup boundary. A malformed live
  inventory quarantines and retains candidates in that pass; a later trusted,
  quiescent pass may prune a proven orphan. A permanent registry would add a
  second source of truth without a demonstrated requirement.
- Treat ReviewGPT as the only cross-cutting review gate for this PR; do not run
  local `deep-review`.

## Verification

- Conflict resolution: merged current `main` with ordinary Git history and
  resolved the documentation index plus runner-bundle baseline conflict by
  retaining the current-main `7,500,000`-byte static-closure baseline.
- Parent audit: found and fixed five concrete gaps in the prior implementation:
  missing send serialization, clobberable check-then-rename adoption,
  hardlink-driven chmod/checkpoint coupling, missing semantic call identity,
  and a destination-swap gap between link-pair validation and chmod.
  A focused owner-design pass led to the smaller link/verify/unlink/reuse design;
  a coverage-write pass found no remaining uncovered changed invariant.
- Focused tests: runtime-state `27` files / `192` tests; vault-send and residue
  `2` files / `51` tests; overlapping generated sends `1` test; runner-bundle
  ratchet `28` tests; scenario integrity `204` scenarios. All passed.
- Package proof: all affected package/app typechecks passed. The canonical
  assistant-engine coverage lane passed `167` files, `2,507` tests with `5`
  skips; final runtime-state coverage passed `27` files and `192` tests.
- Runner assembly: static boot closure `7,528,641` bytes, entry `1,549,429`
  bytes, and total `9,235,659` bytes, all within the retained budgets.
- Full acceptance: syntax, dependency policy, package boundaries, runtime and
  security guards, workspace typechecks, docs hygiene, and every changed-owner
  coverage suite passed. The aggregate run reported two untouched load-sensitive
  tests: the core preference-receipt stress case timed out at 60 seconds and a
  setup-wizard TTY selection mismatched. Their exact isolated reruns passed in
  28 seconds and 158 milliseconds respectively.
- Remaining external gates after the scoped commit: merge the one newly landed
  onboarding-only `main` commit, rerun affected proof, push, refresh the PR
  contract, run exact-head preflight, CI, and ReviewGPT round 4.
Completed: 2026-07-18
