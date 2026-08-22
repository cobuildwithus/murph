# Bound foreground database cleanup ownership

Status: completed
Created: 2026-08-11
Updated: 2026-08-15

## Goal

- Remove foreground global cleanup and harden the existing retention owner's
  compaction claims against contention.

## Success criteria

- Foreground connected-app, sensitive-action, device-connect, and clinical
  intent creation performs no global expired-row sweep.
- One existing retention owner claims expired work in bounded ordered batches
  with `SKIP LOCKED` and explicit pass budgets.
- Mailbox and Linq compaction claims cannot wait behind overlapping workers.
- Focused tests, Web typecheck/lint, privacy scan, and diff checks pass before a
  scoped local commit.

## Scope

- In scope: hosted retention cleanup; foreground expiry sweeps in connected
  apps, sensitive actions, device connect/OAuth, and clinical connect/OAuth;
  mailbox and Linq compaction claims; focused tests and matching durable docs.
- Out of scope: billing provider ownership, crypto preparation, Linq provider
  calls, broad growth snapshot redesign, device recovery, runtime-log isolation,
  and query/index/pointer work owned by sibling tasks.

## Constraints

- Prefer deletion and reuse the existing retention and isolated-store owners;
  add no queue, scheduler, generic cleanup framework, or speculative index.
- Preserve fail-closed auth, privacy, deletion, and exact-effect replay
  semantics. Transactions remain short, bounded, and database-only.
- Treat ReviewGPT patches as proposals. Inspect open PR overlap and retain one
  mutation owner per file/behavior.

## Risks and mitigations

1. Moving cleanup can leave expired rows indefinitely.
   Mitigation: route every removed sweep to the existing bounded retention pass
   and add direct owner tests.
2. Open PRs touch adjacent device/schema/Linq paths.
   Mitigation: inspect their exact diffs, avoid duplicate ownership, and report
   deferred overlap explicitly.

## Tasks

1. Establish the exact main base, open-PR overlap, current query shapes,
   cardinalities, and retention/runtime-log invariants.
2. Ask ReviewGPT for an attachment-based cleanup patch while sibling tasks own
   query/index and isolated runtime-log work.
3. Inspect and integrate only minimal evidence-backed changes, tests, and
   durable documentation.
4. Run focused unit/PostgreSQL proof, typecheck, lint, privacy and diff checks;
   inspect the final patch.
5. Close the plan with a scoped local commit and hand off URLs, overlap
   decisions, rejected proposals, verification, and remaining blockers.

## Decisions

- Base the branch on `05988dd160797405924a72affdb6366f716c141c`.
- Defer or carefully reconcile device-connect/schema work overlapping PR #1675
  and Linq delivery-store work overlapping PR #1642; do not duplicate their
  implementations.
- Leave query/index/pointer and runtime-log isolation changes to their dedicated
  sibling owners; this branch will not touch those files or behaviors.
- Accept the first exact-head ReviewGPT lifecycle finding, then its round-one
  correction: Clinical bearer claims remain non-redeemable at public expiry,
  while a started connected-app callback keeps its exact completion authority
  until one canonical 30-minute owner cutoff shared by callback completion,
  retention, and account deletion.
- Keep retention as the sole physical-row retirement owner. Account deletion
  freezes its provider-cleanup reference time, observes only owner-live started
  connected-app intents, and reads a deterministic `LIMIT 21` probe that admits
  at most 20 external cleanup owners before failing closed without provider
  fan-out.
- Accept the final exact-head ReviewGPT race finding: device and Clinical Records
  OAuth consumers must lock the exact session row before replay classification
  and conditional consume so concurrent `SKIP LOCKED` retention cannot fabricate
  a replay result.

## Progress

- Commits `ddd1cf3a21` and `3aefa120c8` remove foreground global cleanup,
  establish bounded deterministic `SKIP LOCKED` retention, and retain active
  completion owners through the bounded continuation grace.
- Combined focused unit/static coverage passes 141 tests, including exact
  account-deletion predicates and OAuth lock-before-read/update ordering. The
  opt-in real-PostgreSQL concurrency proof passes all four actual-consumer,
  control-artifact, mailbox, and Linq lock scenarios. Hosted Web typecheck and
  scoped lint pass.
- The broader diff fanout previously stalled in an unrelated package test under
  shared host contention and was not retried. Its completed architecture,
  dependency, workspace, and affected typecheck steps remain diagnostic
  evidence rather than a green broad-suite result.
- Final ReviewGPT thread `6a7c2668-d808-83ea-aac1-3bde5f6b093f` was recovered
  through an approved authenticated lane without duplicating the audit. Its one
  actionable race finding is corrected with exact consumer row locks, unit SQL
  ordering assertions, and a real PostgreSQL consumer-versus-retention proof.
  A fresh exact-head follow-up remains required before the plan can close.
- After one authorized normal current-main merge, the effective cleanup patch
  remains the same 28-file behavior scope and has a clean merge-tree. Focused
  proof passes 194 Web tests, 70 device-sync tests, four isolated real-
  PostgreSQL contention tests, both affected typechecks, scoped Web lint, docs,
  architecture, privacy, and diff guards. Exact-head CI then exposed one
  current-main fixture gap: the existing OAuth delegation transaction double
  lacked the `$queryRaw` lock seam now used by the store. The test-only double
  now provides and asserts that seam; its 65-test OAuth slice, Web typecheck,
  lint, privacy, and diff checks pass. Preliminary specialist and final round-1
  ReviewGPT retain their immutable reviewed-head baseline while CI evaluates
  the test-only correction.
- Preliminary specialist thread `6a7ce467-40f4-83ea-a156-f85c0d1655cc`
  identified truthful account-deletion copy, an unbounded connected-app intent
  cleanup read, missing Clinical consumer contention proof, and direct Clinical
  foreground regression cases. Final round-one thread
  `6a7ce4bf-e020-83ea-9e27-62b6048f7bfa` reviewed the same behavior head and
  found divergent connected-app owner cutoffs plus five separable, undisclosed
  lock-skipping query conversions. The corrections use one connected-app
  owner-cutoff helper, bounded ordered account-deletion admission, direct
  Clinical failure tests, and production callback/retention PostgreSQL races.
  The unrelated inbox-media, ingress-latency, assistant-issue, device-webhook,
  and web-session `SKIP LOCKED` conversions are reverted rather than expanding
  this PR's operational surface.
- The connected-app creation path had no member intent-cardinality admission
  bound, and the widened deletion read could therefore collect unbounded
  retained history before making sequential provider calls. The correction
  uses a deterministic expiry/hash `LIMIT 21` probe, admits at most 20 owners,
  and reports a typed retryable backlog state before any provider call.
- Product-experience revalidation verdict: the irreducible purpose is a
  truthful, recoverable deletion result without unrelated maintenance latency.
  The correction is the smallest complete experience: incomplete setup and
  bounded-backlog states now return specific retryable copy while the ordinary
  revocation error remains unchanged. `NO FINDINGS`; no rendered surface
  changed, and focused service tests directly prove the error classification.
- The next exact-head audit found that those two retryable states still used the
  generic browser reload path, which discarded the open confirmation dialog,
  and that their copy incorrectly tied recovery to the hourly cleanup pass.
  The client now preserves the existing dialog and typed confirmation for only
  those owner-live completion states, while every retry still requests fresh
  sensitive-action authorization. Shared copy names the actual completion or
  timeout boundary, component coverage proves both codes, and the existing
  account-deletion design study renders both messages at desktop and mobile
  widths. The required Fable UI check then found that two to twenty unfinished
  setups still selected singular copy; the service now selects singular only
  for one unfinished intent and plural for every larger admitted set. Its final
  maintainability note was resolved by folding the temporary maintenance and
  connected-app frames into one parameterized dialog replica. No new screen,
  state owner, retry loop, or lifecycle was added.
- Final substantive ReviewGPT round 5 reviewed
  `bab5441a7a9515790d348e9dd27a262117713591` in thread
  `6a802efb-687c-83ea-bc22-e54d1b33c26a` and returned
  `ROUND_OUTCOME: PASS` / `REVIEW_COMPLETE`. Its two PR-body discrepancies
  (the superseded seven-test count and omitted Privy surface bullet) were
  corrected in the PR description; neither required a code or plan change.
  Required exact-head GitHub checks, focused local proof, hosted design proof,
  and the corrected Fable UI check are green with no unresolved finding.

## ReviewGPT Round-Two Retrospective

- Trigger: round two found the same public-expiry-versus-completion-owner
  divergence in the device OAuth family after round one corrected connected
  apps.
- Decision: keep the one hourly retention owner, but let it delete only rows
  whose existing durable state proves their work owner is dead. Do not add a
  queue, lease table, scheduler, recovery loop, or compatibility state.
- Device OAuth: unconsumed expired rows are retention-owned; consumed rows stay
  with exact callback finalization, provider-cleanup transfer, and deletion
  recovery.
- Clinical OAuth: unconsumed expired rows are retention-owned; consumed rows
  become eligible only when no incomplete linked connect intent remains.
  Clinical OAuth cleanup therefore runs before completed-intent retirement in
  the same serial pass.
- Connect intents: connected-app, device-connect, and Clinical started rows
  retain their existing bounded 30-minute provider-continuation grace.
  Unbound sensitive-action expiry remains terminal, while approval-backed rows
  remain outside transient cleanup.
- Production-shaped proof now spans lock acquisition, consume commit, retention
  after public expiry, and preservation of the consumed device claim for its
  exact finalization owner.

## Non-obvious affected surfaces

- Privy phone-transfer source retirement treats the physical presence of these
  six control-artifact families as a fail-closed source-disposal fence:
  connected-app intents, device-connect intents, device OAuth sessions,
  Clinical connect intents, Clinical OAuth sessions, and sensitive-action
  challenges.
- Centralized retention must therefore preserve every owner-live row even after
  its public link expires. Existing exact finalization or recovery removes
  consumed device OAuth rows; completed or removed intents release linked
  Clinical OAuth rows; the existing bounded continuation grace releases
  started connect intents; and terminal unbound sensitive-action expiry releases
  transient challenges.
- Phone transfer adds no cleanup or recovery owner. It remains a conservative
  zero-material classifier and becomes eligible only after those existing
  lifecycle owners have removed their rows.

## Verification

- Commands to be selected from the final diff: focused Web Vitest slices,
  PostgreSQL retention tests, Web typecheck and scoped lint,
  `git diff --check`, and identifier/privacy scans.
- Expected outcomes: bounded nonblocking maintenance, no foreground global
  cleanup, and preserved exact-row expiration and consumption semantics.
Completed: 2026-08-15
