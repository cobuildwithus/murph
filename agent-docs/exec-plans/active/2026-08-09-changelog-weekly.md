# Publish the August 5-9 Murph changelog and completion gate

Status: active
Created: 2026-08-09
Updated: 2026-08-10

## Goal

- Publish a complete, member-facing catch-up changelog for August 5 through
  August 9, 2026, with explanatory visuals for the most important behavior.
- Make same-PR changelog coverage the durable default for future member-visible
  changes through a repo-local skill, completion-workflow guidance, PR-body
  declaration, and mechanical guard.

## Success criteria

- The latest changelog window contains one stable edition per day for August
  5-9 and preserves older cursor/permalink behavior.
- Every included claim is grounded in merged PR evidence, groups related work
  by member outcome, and retains the complete source-PR list.
- Major interactions have compact responsive visuals built from the existing
  changelog visual language, and the real archive surface remains represented
  in the design catalog with synthetic data.
- `.agents/skills/write-changelog` validates and explains the inventory,
  writing, visual, privacy, testing, and PR-description standard.
- The completion workflow and PR template require either an updated changelog
  or a concrete not-applicable reason, and CI verifies the declaration.
- Focused tests, Web typecheck, browser proof, specialist review, exact-head CI,
  and the normal scoped commit/PR workflow all complete successfully.

## Scope

- In scope: the public changelog registry and page, reusable changelog visual
  primitives, the changelog design-catalog study, focused tests, the repo-local
  authoring skill, completion workflow, PR template, and PR-body CI guard.
- Out of scope: production behavior changes to the shipped features described
  by the changelog; internal-only release notes; decorative raster artwork;
  retrospective edits to already accurate editions before August 5.

## Constraints

- Technical constraints: preserve stable edition/item IDs, seven-edition page
  windows, old permalinks, public feed/card contracts, accessible responsive
  rendering, and existing package ownership. Add no dependency or state owner.
- Product/process constraints: publish only evidence-backed shipped truth; do
  not expose private evidence or security-sensitive implementation detail;
  describe user outcomes in Murph's precise, calm voice; preserve unrelated
  work; use the isolated worktree and PR completion lane.

## Risks and mitigations

1. Risk: a high-volume week turns into an unreadable commit dump or misses
   meaningful member-facing work.
   Mitigation: inventory every first-parent merge after the last published
   source PR, then group related PRs under one bounded member outcome while
   retaining all source numbers.
2. Risk: visuals decorate the page without clarifying behavior or drift from
   production interaction patterns.
   Mitigation: reuse or extend the existing compact mock primitives, keep every
   fixture synthetic, require factual access/route/status claims to derive from
   an existing production owner, and update the real design-catalog study plus
   desktop and mobile proof. Delete a visual when prose avoids parallel state.
3. Risk: a universal changelog rule encourages internal or sensitive details
   to be published.
   Mitigation: require coverage for member-visible outcomes, allow one explicit
   not-applicable reason for internal-only work, and make privacy/security
   redaction part of the skill and workflow.
4. Risk: the new PR guard creates brittle false positives.
   Mitigation: validate the explicit PR-body disposition and changed changelog
   path rather than guessing product impact from directory names; cover both
   passing and failing declarations with focused tests.

## Tasks

1. Reconstruct the August 5-9 member-visible shipment inventory from exact
   merged PR bodies, diffs, and current product contracts.
2. Add the five editions, reusable explanatory visuals, visual registry
   entries, design-catalog coverage, and focused changelog assertions.
3. Initialize and write the `write-changelog` skill, then validate its metadata
   and instructions.
4. Update the completion workflow and PR template, implement the PR changelog
   declaration guard, and add it to the existing all-PR body-guard workflow.
5. Run focused tests, typecheck, diff/privacy review, browser proof, and the
   required specialist review.
6. Commit, push, open the PR, resolve exact-head CI/review findings, archive
   this plan, and hand off the complete result.

## Progress

- Reconciled all 65 first-parent merges in the August 3-9 window. The public
  archive now cites 57 member-facing merges; the remaining eight are limited to
  operator logging/telemetry, an internal ops chart, test-only coverage, a
  dormant persistence path, deploy verification, and incident-process docs.
- Added or expanded the August 5-9 editions to 60 new catch-up items across the
  current seven-day window, with stable item IDs and source-PR attribution.
- Added reusable compact-table and reference-band visuals, a synthetic contact
  avatar state, and explanatory production visuals for the priority and
  interaction-heavy entries. Updated the synthetic archive study.
- Added and validated `.agents/skills/write-changelog`, the completion-workflow
  rule, PR template declaration, and all-PR CI guard with focused tests.
- Focused changelog tests, PR guard tests, Web typecheck, scoped ESLint, docs
  drift, skill validation, diff checks, and privacy checks pass. Playwright
  rendered 70 public cards with HTTP 200, no page errors, and no desktop or
  mobile overflow.
- Uploaded and inspected four desktop/mobile design-proof pairs. The required
  Claude UI double-check was attempted with Fable 5 and ended at explicit usage
  credit exhaustion, so no second-model verdict is claimed.
- Rebasing onto the latest `main` shifted the archive page boundaries. Updated
  the visual regression fixture to render the three real seven-day windows
  containing its assertions, then reran the exact-head checks successfully.
- Preliminary `completion-specialists` ReviewGPT reviewed pushed head
  `1ebceeb537` with the requested GPT-5.6 Sol target and returned findings after
  the five-minute trust floor. Accepted the public-jargon and registry-proof
  findings; the frontend lens returned no finding and no patch artifact.
- Rewrote the affected public entries around observable outcomes and added a
  regression assertion against the named internal terms. Strengthened the PR
  guard to resolve every declared date/item pair against the authoritative
  registry and reject unknown, wrong-date, duplicate, malformed-extra, and
  mixed valid/invalid references.
- Rejected the reported missing marketing-context owner: the exact pushed
  checkout tracks `agent-docs/product-marketing-context.md`, and `git cat-file`
  proved every path in the skill's required preflight exists. The review ZIP
  omitted that unchanged document; the repository and skill reference agree.
- Final ReviewGPT round 1 found two production-faithfulness defects. Corrected
  experiment-link copy to describe ordinary authenticated canonical routes and
  deleted the generic contact-photo action because only a fresh direct iMessage
  conversation can fulfill it. Added focused regression coverage; the exact
  remediated head passed all GitHub Actions.
- Final ReviewGPT round 2 verified both corrections, then required a
  retrospective after finding that two hand-authored health-connection visuals
  repeated the same parallel-authority mechanism: they showed Polar as an Apple
  Health relay and assigned live status to guide-only relay sources, contrary to
  the production `/connect` owners.
- Final ReviewGPT round 3 verified every earlier correction and found one last
  retained fixture from the same mechanism: the public referral visual assigned
  all group-mission credit to the room even though the production owner credits
  the personal or group Murph where the mission was accepted. Deleted the
  visual and added render-level assertions against unconditional beneficiary
  language; `/refer` remains the sole owner of current reward destinations.
- Final ReviewGPT round 4 verified all prior corrections, then found that the
  scheduled-tools item and its email visual promised a connected-account email
  send from scheduled automation even though the production authorization
  boundary permits that write only from current accepted input in a private
  conversation. Deleted the impossible visual and split the bundled entry into
  four exact outcomes: scheduled calling on its supported direct route,
  route-safe scheduled tools, same-turn bounded group calls, and current-private
  connected email. Focused registry and render assertions reject the old
  scheduled-email claims.
- Final ReviewGPT round 5 verified every prior correction, then found one
  separate consent-copy overclaim: the sleep entry said all sleep sharing used
  one permission even though production keeps Deep sleep and REM sleep
  independently selectable. Reworded the item to name both permissions and
  clarify that source details were folded into each stage's own choice. Added
  focused registry coverage against the collapsed-consent claim.
- Final ReviewGPT round 6 verified every prior correction, then found two
  feedback trust-surface overclaims: an ordinary-feedback mock visibly promised
  a handoff that production intentionally keeps silent and best-effort, while
  both feedback entries promised semantic removal of private or health meaning
  beyond the bounded pattern scrub production enforces. Deleted both misleading
  mocks, rewrote the entries around bounded model-written summaries and their
  residual free-text boundary, and added registry and render regressions.

## Decisions

- Use five dated editions, August 5 through August 9, rather than one weekly
  mega-edition so the stable cursor remains an exact seven-day archive.
- Treat performance, recovery, messaging fidelity, availability-preserving
  maintenance, and UX clarity as public improvements when a member can perceive
  the outcome; omit internal-only ops, telemetry, dormant plumbing, and
  security implementation detail.
- Prefer behavioral UI mockups over generated decorative imagery. The product
  change is interaction-heavy, and the existing changelog primitives explain
  those interactions more truthfully than illustrative art.
- Name the repo-local skill `write-changelog` so PR authors and reviewers can
  invoke it directly.
- Enforce an explicit `updated` or `not applicable` PR-body disposition, with
  a changed-path check for `updated`, instead of attempting unreliable path-
  based inference about whether a change is member-visible.
- Read the authoritative TypeScript changelog literal with one strict,
  fail-closed delimiter scanner in the Node guard. This avoids a generated
  mirror and a new parser dependency; unsupported future registry structure
  fails the PR check instead of silently accepting an unverified reference.
- Retrospective decision: existing product owners remain authoritative for
  route capability, authentication, health-data ownership, consent scope,
  reward ownership, connection status, feedback completion, and redaction
  limits. Source PRs prove release provenance but do not make a changelog
  fixture a live-state owner. Default to shrinking: delete a factual visual
  unless it reuses canonical data/components or has a focused contract
  assertion against the owner. Do not add synchronization machinery.
- Re-audited all 60 catch-up items and the 51 original associated visuals under
  that rule. Six original items were intentionally text-only. Deleted two
  contradictory health-route/status visuals, the unconditional
  referral-beneficiary visual, the scheduled connected-email completion visual,
  and two misleading feedback acknowledgement/redaction visuals. The retained
  45 are bounded as 18 synthetic output examples
  (message, table, card, chart, or artifact shape), 15 sequence/recovery
  diagrams (ordering and negative branches), and 12
  choice/handoff/consent illustrations tied to the existing referral, billing,
  message-routing, authorization, settings, and automation owners. The Apple
  Health entry now has a focused test derived from the production relay-source
  list and rejects Polar; the page test rejects the deleted status fixtures.
- Extended `$write-changelog` and the completion workflow with the same
  production-owner gate so future visual work deletes parallel factual state
  instead of inventing another authority.
- Extended that gate after round 4 so asynchronous, scheduled, and detached
  claims must trace their exact invocation scope, channel, audience,
  current-input requirement, final destination, and retry or reconciliation
  behavior. Ordinary private-turn tool availability never implies scheduled or
  cross-channel availability.
- Extended the owner gate after round 5 so a simpler choice inside one consent
  scope cannot be described as merging independently selectable permissions.
  Changelog claims must name those member-facing scopes explicitly when the
  product still lets a member approve them separately.
- Extended the owner gate after round 6 so feedback claims must preserve silent
  versus visible completion semantics and distinguish raw-field exclusion or
  deterministic pattern scrubbing from semantic removal of all private or
  health meaning.

## Verification

- Passed: skill quick validation; nine changelog-disposition guard tests and
  ten frontend-proof guard tests; 41 focused Web Vitest assertions for
  registry, page, feed/card/API behavior; Web typecheck; scoped ESLint;
  `pnpm docs:drift`; `git diff --check`; privacy and public-copy punctuation
  scans.
- Passed: desktop/mobile Playwright proof from the latest public archive and
  `/design?tab=sections#changelog-archive`; 70 cards, HTTP 200, zero page
  errors, zero horizontal overflow, and native-resolution inspection of local
  and hosted design-proof images.
- Recorded gap: the Fable 5 Claude UI check reported explicit usage-credit
  exhaustion, which the completion workflow treats as non-blocking without a
  substitute verdict.
- Passed before the retrospective correction: preliminary specialist review;
  all exact-head GitHub Actions; 47 focused registry/page/design assertions;
  19 PR/design guard tests; Web typecheck; scoped lint; browser proof; skill and
  docs validation.
- Passed after the round-4 correction: 41 focused changelog registry/page/route
  tests, Web typecheck, scoped lint, docs drift, skill validation, and diff
  checks. Exact-head Playwright rendered 73 public cards at desktop and mobile
  widths; both public and design-study routes returned 200 with zero page
  errors or overflow, and the rejected scheduled-email, health-relay, and
  referral-beneficiary phrases were absent. The refreshed scheduled-call card
  captures were inspected and uploaded through the lossless design-proof
  variant.
- Pending: commit and push the round-6 feedback correction, complete final
  ReviewGPT round 7, confirm exact-head CI and merge readiness, and close this
  plan.
