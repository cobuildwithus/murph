# Upcoming context correctness through existing owners

Status: active
Created: 2026-09-16
Updated: 2026-09-16

## Goal

- Correct PR #3494's plan editing, timing precision, source-history growth,
  disconnect invalidation, and source identity bounds through existing owners.

## Success criteria

- Public typed commands update plans without overwriting a newer revision.
- All-day precision survives projection; large mapping history keeps controls readable.
- Successful disconnect suppresses context; long source identities stay retry-safe.
- Focused deterministic/live proof, relevant typechecks, and final PR gates pass.

## Scope

- In scope: existing event, connected-context ledger, and snapshot owners.
- Out of scope: new databases, schedulers, factual stores, production mutations.
- Journal navigation currently excludes future dates; await the user's preference
  before extending that behavior.

## Constraints

- Preserve canonical corrections, tombstones, private/group isolation, opt-outs,
  and independent follow-ups. Keep completed plans immutable.
- Resume the clean existing PR checkout at 4fa81e0 under the user's correction request.

## Risks and mitigations

1. Partial disconnection: use the existing canonical Knowledge writer and receipts
   to update eligibility, keeping account removal and history ownership explicit.
2. Existing ReviewGPT has three completed rounds. Finish concrete fixes and proof
   before resolving the documented next-round boundary.

## Tasks

1. Extend typed event edits and bounded source identity creation.
2. Preserve timing precision and read bounded controls independently of history.
3. Reconcile successful account disconnect through the existing ledger owner.
4. Run focused regressions and assistant journey; update owner docs and contracts.
5. Review, commit, and update the PR with current proof and final gates.

## Decisions

- Controls occupy the first JSON line of the existing Knowledge ledger; mappings
  follow in the same document. No second state store or lifecycle owner.

## Verification

- Typed CLI creation/edit/reverification/stale revision and long-key retry tests.
- All-day/timed projection, large mapping history, actual disconnect-path tests.
- Focused real-Codex journey, CLI/engine typechecks, generated contract checks,
  complexity guard, parent privacy/diff review, and exact-head CI.

## Implementation and evidence

- Implemented all five corrections through the existing owners. Disconnect
  failures distinguish remote rejection from a successful remote disconnect
  whose local control update failed; they do not claim suppression prematurely.
- Typed CLI suite: six passing tests. Engine projection, connected-app, and
  context-snapshot suites: 53 passing tests. Composed prompt/private-group
  selection: 17 passing tests before the additional failure-path test.
- CLI, engine, and Web typechecks passed. Generated CLI contracts refreshed;
  ten changelog render tests passed after preparing generated fragments.
- Complexity and workspace import-boundary checks passed. New ledger helper
  maximum complexity is four; projector is twenty. Existing larger dispatch
  functions are unchanged. Parent diff/privacy review found no remaining
  accepted issue in this correction scope.
- Complete loopback provider-input fixtures passed: direct 143666 to 145028
  bytes, group 131269 unchanged. These fixtures omit the optional CLI contract;
  token counts remain unavailable without the exact model tokenizer.
- The new all-day correction live journey and updated calendar/retry journey
  are not yet proven on this candidate: local subscription authentication
  failed before any model action. The default home and all eight available
  alternate authenticated homes were tried once; subscription sign-in must be
  restored before this proof can run. No auth material was copied or persisted.
- Remaining gates: focused live proof, exact-head CI, and a resolved final
  review for the new runtime delta. Prior ReviewGPT rounds remain recorded
  against their actual heads; none covers these subsequent corrections.
- CI exposed two unnecessary dynamic import boundaries: production packaging
  produced 26 static startup chunks against the existing limit of 24. Reusing
  ordinary imports of the existing ledger and Knowledge owners removes those
  boundaries without raising a budget. The full production runner assembly,
  33 affected engine tests, engine typecheck, and import-boundary check pass.

## Review cap retrospective

- Round one found a legacy event-history lookup blocker; its accepted correction
  filters source identities before validating unrelated records. Round two passed.
- The bounded schema import correction then received round three PASS.
- This task's five independently reproduced issues were explicitly authorized
  for correction. They add typed fields and reuse existing state and write
  owners, without new stores, queues, or synchronization mechanisms.
- The three-round count and first-reviewed head remain immutable. Do not start
  a fourth substantive review without the documented continuation decision.
