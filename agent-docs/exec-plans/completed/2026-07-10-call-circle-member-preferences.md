# PR 444 Call Circle Completion

Date: 2026-07-10
Status: completed
Spec: `agent-docs/product-specs/call-circle.md`
Branch: `feat/call-circle-v1-f5`

## Goal

Finish PR #444 and let an enrolled member tell their own Murph how often they
are open to a Call Circle match by default and with a specific same-group
member: weekly, every other week, monthly, or never.

Success means these choices are durable, independently editable, enforced by
the deterministic matcher and proposal-creation authority, private from every
other member and the group runtime, and implemented without another table,
column, consent system, identity owner, queue, or scheduler. The verified PR
review findings must also be corrected or explicitly resolved in the durable
spec, with honest coverage and a current PR body before merge readiness.

## Design

- Extend the existing `HostedCallCirclePreferences` JSON value with one default
  cadence and bounded per-member cadence overrides. `never` is the exclusion
  value; it does not need a separate exclusion primitive. Schema defaults keep
  old stored values compatible.
- Treat the member response as a preference patch. Availability, cadence, and
  member overrides can change independently without the model reconstructing
  fields the member did not change.
- Resolve the group from existing mailbox/member authority. Accept only bounded
  member ids, validate them against that group's current membership, reject a
  self-targeted override, and never accept phone numbers or model-supplied group
  ids.
- Keep `nextMatchingAt` as one weekly due cursor. The pure matcher applies each
  candidate's effective cadence to recent history, and proposal creation
  rechecks it under the existing stable member locks. `never` from either side
  vetoes the pair. Overrides remain visible only to their setter and affect
  future proposals only; they do not expose the choice or cancel an existing
  proposal.
- Fix the verified cadence jitter, cross-phase clock drift, quiet-hour setup and
  terminal-notification gaps, stale notification recovery, confirmation
  revocation, canonical id ordering, legacy join-offer deploy skew, URL false
  positive, and dead Linq helper at their current owners.
- Record the intentionally accepted v1 residuals instead of adding machinery:
  an unlike does not revoke enrollment, and a provider call already claimed at
  the pause boundary may still begin in the documented sub-second race.

## Proof

- Hosted execution schema/parser tests for defaults and strict patch shapes.
- Response/store tests for merge behavior, membership validation, no hidden
  resume, and private per-member cadence updates.
- Matcher/scheduler/match-store tests for weekly, biweekly, monthly, and never
  eligibility, concurrency rechecks, cadence slack, one scheduler timestamp,
  quiet-hour setup deferral, and explicit terminal notifications.
- Writer-to-parser round-trip proof for confirmation anchors, a bounded
  notification-recovery cutoff regression, legacy join-offer parser proof, and
  the first-contact time-text false-positive regression.
- Durable architecture, security, product, testing, and deployment docs aligned
  with the actual server-authored offer and current runtime surfaces.
- Required diff coverage, typecheck/build lane, security/privacy audit,
  coverage-write audit, parent final review, and PR ReviewGPT loop.

## Progress

- Implementation, focused tests, workspace typechecks, app lint, app builds,
  and changed-owner coverage are complete.
- `pnpm verify:acceptance` completed every changed-owner and app lane; its only
  failure was a 60-second timeout in an unchanged CLI expansion test during
  concurrent fanout. The exact file passed all 13 tests immediately when rerun
  alone.
- The required security/privacy audit found no medium-or-higher issue. The live
  Retell configuration, Linq `message.sent` echo, deployed recovery predicate,
  and full gated Call Circle scenario remain pre-enable operational proof.
- Coverage-write added one symmetric `never`-veto matcher proof; the focused
  suite passes. Parent final review found no further implementation gap.
- PR update, ReviewGPT, and final CI are still pending.
Updated: 2026-07-10
Completed: 2026-07-10
