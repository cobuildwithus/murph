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
- Out of scope: new databases, schedulers, factual stores, and future-date UI.
- The latest user instruction authorizes final review, fixes, merge, and normal
  protected deployment; rollback remains outside that authorization.
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
  bytes before the proactive prompt edit, group 131269 unchanged. These fixtures omit the optional CLI contract;
  token counts remain unavailable without the exact model tokenizer.
- The new all-day correction live journey and updated calendar/retry journey
  are not yet proven on this candidate: local subscription authentication
  initially failed before any model action. The earlier environment-based
  alternate-home attempts were invalid because the runner discards that override.
  Retrying with --codex-home reached a working subscription. No auth material
  was copied or persisted.
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

## Proactive reply guidance and completion authorization

- The user approved proactive preparation advice from relevant upcoming plans,
  then explicitly authorized a fourth and final review, fixing its findings,
  merge, deployment, and additional checks of existing Journal behavior.
- Outcome: relevant upcoming constraints shape advice without the member having
  to mention them. Reaches: private replies and existing reminders; unrelated
  questions, group privacy, quiet capture, and schedule authority stay intact.
- Proof: composed prompt assertions, three real-model relevance/irrelevance
  journeys, canonical Journal/query/UI regressions, and exact-head CI.
- Earlier alternate-home live attempts used an environment override that the
  test runner discards. They did not actually test the alternate homes. Retry
  with the documented --codex-home argument before declaring authentication
  exhausted, and correct the PR evidence accordingly.
- Round four is now authorized. Preserve the original first-reviewed head and
  prior review ledger; include the final prompt change in the review candidate.

## Final candidate regression evidence

- Existing Journal behavior: 155 passing checks across canonical storage (10),
  query views (28), typed/legacy CLI and experiment flows (57), capture,
  follow-up and automation lifecycle (56), and page navigation (4).
- Proactive prompt/projection checks: 17 passing; changelog rendering: 10 passing.
  Engine and Web typechecks, complexity guard, and complete provider-input
  fixtures pass. Final direct input is 145274 bytes, +1608 bytes (1.1193%);
  assembled instructions are 85530 bytes. Group input and tool bytes are unchanged.
- The first successful live provider call gave useful travel preparation while
  preserving uncertainty. Its test rejected the equivalent wording "may";
  the assertion now accepts that ordinary uncertainty marker. No production
  instruction was changed to satisfy this test-only correction.
- A later live reply made tentative travel sound settled. The existing context
  guidance now requires conditional advice for tentative plans. Composed prompt
  and provider-input proof were rerun; direct reply, reminder, and unrelated
  factual-answer journeys pass with no tool actions or extra messages.
- The all-day correction journey passes on Terra high: one existing record
  changes, date-only timing remains, and no duplicate or reminder is created.
- The Luna capture journey exposed ambiguous follow-up reference guidance: it
  used the note subtype instead of the canonical event family. The existing
  capture skill now gives the exact event reference shape. A materialized-skill
  contract assertion and the existing live exact-reference assertion cover it;
  no new reference resolver, persistence owner, or schema rule is introduced.
