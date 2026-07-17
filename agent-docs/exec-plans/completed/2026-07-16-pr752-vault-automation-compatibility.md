# PR 752 vault automation compatibility

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Prove PR 752 reads and upgrades an existing legacy vault safely, and close
  the smallest verified automation migration gaps before release.

## Success criteria

- Every supplied legacy automation, cron runtime row, run record, and outbox
  intent parses under the new schemas without changing canonical files.
- Managed automation application is idempotent and does not change unrelated
  user automations.
- A user archive clears reconciliation-only reactivation authority.
- A future legacy one-shot remains at its stored time when a replacement
  occurrence is already stale but its finite delivery window remains open.
- An untagged legacy progress automation can resolve its experiment owner
  without depending on managed setup winning the migration race.
- Focused tests, scoped diff verification, real-vault replay, CI, and the
  required ReviewGPT remediation round pass.

## Scope

- In scope: automation marker lifecycle, managed one-shot schedule migration,
  legacy experiment-progress ownership resolution, focused regression tests,
  disposable real-vault compatibility proof, PR update, CI, and ReviewGPT.
- Out of scope: new automation concepts, broad experiment error recovery,
  generic legacy outbox authority reconstruction, deployment, or merging.

## Constraints

- Preserve user-paused and user-archived intent.
- Keep legacy fields optional and omit null lifecycle fields on rewrite.
- Do not expose private vault contents or identifiers in logs or durable
  artifacts; report aggregates only.
- Use the existing canonical ownership and lifecycle primitives; add no new
  persisted state or service.

## Risks and mitigations

1. Risk: compatibility handling weakens current support-series ownership.
   Mitigation: retain immutable series ownership and limit fallback lookup to
   the deterministic legacy progress automation ID.
2. Risk: schedule migration causes an early or repeated user message.
   Mitigation: separate occurrence staleness from finite delivery-window
   expiry and cover both in focused tests.
3. Risk: a repair rewrites unrelated legacy automations.
   Mitigation: replay managed setup twice on a disposable full-vault copy and
   compare field-level deltas.

## Tasks

1. Add failing regressions for the three verified migration defects.
2. Apply the smallest production fixes at the existing owner boundaries.
3. Run focused tests, scoped verification, and the real-vault replay.
4. Run the required coverage-write review and parent final review.
5. Close the plan, commit, push, start ReviewGPT with CI, and resolve the
   resulting exact-head gates.

## Decisions

- Keep authority-less legacy outbox intents compatible. The supplied vault has
  no in-flight automation sends, and old rows lack enough identity to fail
  closed selectively without dropping unrelated user-critical messages.
- Keep malformed experiment documents fail-visible. The supplied legacy vault
  parses completely; silently skipping malformed canonical product truth would
  weaken outcome and lifecycle guarantees.
- Do not add collision managers or expand the 4,096-record reconciliation cap;
  neither condition exists in the supplied vault or current production proof.
- Treat occurrence staleness and delivery-window expiry as separate facts.
  A future stored legacy occurrence remains valid while the finite window is
  open, even when the replacement occurrence has already passed.
- Resolve only the deterministic legacy progress automation ID when immutable
  series ownership is absent. Do not introduce a second persisted ownership
  source or infer ownership from mutable slugs.

## ReviewGPT cap retrospective

- The PR has used five substantive rounds. Round 1 forced a large-change
  retrospective and release correction: the unrelated Clinical Records slice
  was deleted, two release-boundary failures were closed, and WHOOP legacy
  `sleepType` enrichment was narrowed to its demonstrated compatibility case.
- Rounds 2 through 4 progressively corrected the same WHOOP provenance seam:
  preserve a newer canonical revision, stop treating a source-retaining user
  edit as provider-authored, then prefer exact typed provider history before
  the stripped legacy fallback. Each fix reused the existing revision and
  fingerprint owners; no migration, queue, or second provenance index was
  added.
- Round 5 found that the hosted snapshot recovery proof assumed the initially
  observed snapshot was still the retained recovery source. The accepted fix
  anchored the assertion to the actual retained v2 ref. It changed test proof
  only and added no production complexity.
- The five rounds converged rather than expanding the architecture. This new
  compatibility patch is justified by direct replay of the supplied legacy
  vault on a different boundary: automation migration. It adds no persisted
  field or state owner and is limited to three verified defects.
- Per the five-round hard cap, do not start round 6 automatically. First make
  the coverage audit, parent review, exact-head verification, CI, and
  mergeability green, then obtain an explicit continuation decision.

## Verification

- Before the production fixes, the three new focused regressions failed while
  the other 108 focused tests passed. After the fixes, all 111 focused tests
  passed.
- `pnpm test:diff` passed for the six touched source and test files, including
  affected workspace typechecks, package tests, Cloudflare verification, web
  tests, lint, and production build.
- On a disposable copy of the supplied full vault, all 70 automation documents
  parsed through both core and query layers. All 21 eligible canonical records
  projected into cron, all 390 cron-run records parsed, and all 103 outbox
  intents parsed. No pending automation delivery was present.
- Managed setup changed only two existing managed automation documents, only
  in instructions and update timestamps; it created, deleted, rerouted, or
  rescheduled none. A second application made no automation changes.
- Deterministic outcome maintenance created the two due outcome documents and
  linked the two corresponding experiments, then became idempotent.
- The required independent coverage-write pass made no edits. It found the
  existing regressions sufficient at stable boundaries and confirmed existing
  read-failure and retry proof closes the adjacent error paths.
- Exact-head PR CI and ReviewGPT remediation review.
Completed: 2026-07-16
