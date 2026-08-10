# Publish the August 5-9 Murph changelog and completion gate

Status: active
Created: 2026-08-09
Updated: 2026-08-09

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
   fixture synthetic, and update the real design-catalog study plus desktop and
   mobile proof.
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
- Added or expanded the August 5-9 editions to 57 new catch-up items across the
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

## Verification

- Passed: skill quick validation; 23 PR-body guard tests; 40 focused Web
  Vitest assertions for registry, page, feed/card/API behavior; Web typecheck;
  scoped ESLint; `pnpm docs:drift`; `git diff --check`; privacy and public-copy
  punctuation scans.
- Passed: desktop/mobile Playwright proof from the latest public archive and
  `/design?tab=sections#changelog-archive`; 70 cards, HTTP 200, zero page
  errors, zero horizontal overflow, and native-resolution inspection of local
  and hosted design-proof images.
- Recorded gap: the Fable 5 Claude UI check reported explicit usage-credit
  exhaustion, which the completion workflow treats as non-blocking without a
  substitute verdict.
- Pending: preliminary `completion-specialists` ReviewGPT, exact-head GitHub
  Actions, merge-conflict proof, parent final review, and plan-closing commit.
