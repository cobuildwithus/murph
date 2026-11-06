# Game v1 rules and additive schema

Status: completed
Created: 2026-10-22
Updated: 2026-10-22

## Outcome and invariants

New games run 3–365 days (default seven), begin on the accepting player's eligible
same day before 20:00, and carry one prize or dare. Tasks and stakes lock at
kickoff. Legacy rows and settlement remain readable. Post-to-unlock and two
attempts remain unchanged. One additive migration prepares all artifact storage.

## Owners and evidence

The game command validator, pure rules, locked service, and viewer projection
already own these decisions. Current sources cap games at 28, always schedule
tomorrow, allow live stake/task changes, and omit streak, usual kind, and ticket
kind. Extend those owners; derive the new read fields from canonical entries and
terms. No new service, dependencies, persisted projections, or background work.

## Product UX

Effort: feature. New inviter and accepter see prize/dare and variable duration.
Acceptance and negotiation approval use the actual approver's game-local clock;
03:00 and 20:00, date-line differences, and an explicit future date are distinct
journeys. Live games refuse task/stake edits, including before Day 1; duration
and schedule edits preserve started days. Legacy games keep scoring/tickets.
Invite web and share card use the real component study at phone and desktop.
Proof: focused rules/routes/service tests, loopback PostgreSQL, API smoke, and
rendered design proof. Done when these journeys are Ready and release gates pass.

## Scope and rollout

PR 2 owns rules, derived fields, invite presentation, and all v1 DDL/plumbing.
PR 3 owns artifact validation/sealed writes and free daily kind selection.
Runtime reader deployment and group-chat changes belong to the other lane.
The widened constraints are installed NOT VALID under a short metadata lock,
then validated separately. Nullable payload and separate plain blur preview permit old writers. Merge only
once the compatible runtime reader is deployed and warm runtimes converged.
Existing ticket kinds remain accepted for stored rows. New tickets derive kind
from the stake key without another column. Chat days use a bounded recent window
while score and target retain whole-game totals.

## Tasks

1. Extend rules and projections, retaining existing authority and transactions.
2. Add migration, schema, exact statement guard, inventory and regression proof.
3. Update invite copy/study, owner docs and changelog.
4. Run focused deterministic/PostgreSQL/typecheck/lint/guard and API/rendered proof.
5. Review complete diff; run requested read-only Codex deep review.
6. Close plan, scoped commit, push, Ready, start sensitive ReviewGPT with CI.
7. Resolve findings, prove exact-head gates and lane A convergence, merge.
8. Verify predeploy migration, production admission, health and exact deployment.

## Verification

- Focused game and migration checks: 378 passed, PostgreSQL selected separately.
- PostgreSQL rules/service/negotiation/changes/chat: 51 passed; API handler smoke
  passed using real authentication and dev start/advance/settle routes. New
  maximum legacy ticket proof passed at five games and 5,475 tickets.
- Design proof passed at 390px and 1280px; dare/prize captures inspected.
- Complexity guard: no hotspots; logs guard, docs drift and Web lint passed.
- Web and Assistant Engine typechecks pass after rebasing onto the merged
  reader floor. No runtime reader edits are duplicated in this lane.
- Real-Codex windowed progress journey passed on the local subscription using
  gpt-6.1-sol: one read, no writes, correct 40/30 full-game scores. Reply Ready.
- Requested deep review identified the old ticket query ceiling. Accepted and
  fixed with one derived bound; maximum-cardinality PostgreSQL proof passes.
- Required CI, ReviewGPT and deployment gates remain pending.

## Status

Implementation and local proof are complete. The reader floor is merged; its
runtime deployment and convergence still gate this writer. ReviewGPT, exact-head
CI and production verification continue through the PR completion workflow.
Completed: 2026-10-22
