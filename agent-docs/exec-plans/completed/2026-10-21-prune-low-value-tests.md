# Replace low-value test clusters with composed flow coverage

Status: completed
Created: 2026-10-21
Updated: 2026-10-21

## Goal

Substantially reduce tests that freeze source spelling, prose, CSS, or internal
structure. Replace heavily pruned clusters with focused executable journeys
through existing browser, CLI, assistant, and bundle owners.

## Success criteria

- Remove substantial, individually justified clusters without deleting meaningful
  authorization, billing, health-safety, durability, or recovery coverage.
- Exercise real public boundaries and observable outcomes in replacement tests.
- Run focused replacement/retained suites and affected typechecks.
- Review the final diff, document remaining evidence gaps, and make a scoped commit.

## Scope

- Web presentation tests and browser journeys.
- Package public-surface/knowledge tests and CLI journeys.
- Assistant skill prose tests and focused real-Codex journeys.
- Container/bundle source snapshots and executable filesystem/bundle journeys.
- Test-map and verification documentation describing retained proof.

Production code, product policy, dependencies, deployment, and broad CI admission
remain unchanged unless a concrete test-discovery correction is needed.

## Constraints and architecture

Existing production owners remain authoritative. The gap is proof that follows
implementation spelling instead of observable behavior. Delete that machinery
and reuse existing end-to-end harnesses; do not introduce a testing framework,
duplicate production logic, or move canonical state. Test fixtures remain
synthetic and contain no private transcripts, credentials, or personal paths.
Failure, retry, authority, and persisted-state behavior retain their executable
regression coverage. No deploy skew is introduced by test-only changes.

## Risks and mitigations

- Missing a unique invariant: map each removal cluster to retained proof and
  review security, state, and failure assertions separately.
- Overly broad or flaky replacements: focused scenarios, real existing owners,
  bounded fixtures, observable effects, and no incidental wording expectations.
- Unavailable live dependencies: report exact failed commands and distinguish
  static/typecheck evidence from actually executed end-to-end proof.

## Tasks

1. Audit four disjoint areas in parallel and identify coherent removal clusters.
2. Remove low-value cases and add composed/browser/live replacements.
3. Reconcile test discovery and current proof documentation.
4. Run focused verification and affected typechecks; inspect the complete diff.
5. Close this plan and commit the scoped change.

## Decisions

- The user explicitly requested aggressive pruning and parallel agents.
- Preserve useful unit tests when they prove a unique invariant; test size alone
  is not a deletion criterion.
- No member-facing changelog: this is internal verification maintenance.
- Parent owns integration, documentation, verification, review, and commit.
- Removed 29 whole test files and pruned redundant cases from the retained
  suites. The main clusters are static homepage/design markup, assistant skill
  prose, package public-surface spelling, and runner assembly source snapshots.
- Kept the two executable biomarker filter/search component cases because the
  screenshot and design-page wrappers intentionally make that preview inert.
- Removed the obsolete Starter SQL substring case from the billing workflow
  and its guard. Exact-SQL migration execution remains in required PostgreSQL
  coverage. No secret-bearing job or production admission policy changed.
- Historical completed plans and the point-in-time feature audit retain their
  original test references; current test owners and CI references were updated.
- Final ReviewGPT is not required for this test maintenance change. The parent
  reviewed changed paths, removed assertions, replacement flows, and CI wiring.

## Verification

- `pnpm typecheck`: passed workspace tools, packages, and both apps.
- `pnpm --dir apps/web typecheck:prepared` and targeted ESLint: passed after
  the final Web edits.
- Web retained proof: 56 cases across eight files passed, covering auth/layout,
  biomarker interactions and range/provenance, consent/export, and health claims.
- Playwright `public-content-journeys.spec.ts` and
  `murph-safe-search.spec.ts`: three browser journeys passed against an
  isolated local server. Both files are included in the existing CI command.
- `pnpm build:test-runtime:prepared`, CLI typecheck, and six focused package
  suites: passed, including 37 cases and the fresh-process knowledge lifecycle.
- Cloudflare focused container/bundle/report proof: passed. The retained
  operational report suite also passed all three cases against an isolated
  loopback PostgreSQL database, with no skipped database proof.
- Retained Starter and meal-photo migration PostgreSQL suites: both passed
  executing their exact migration SQL against isolated synthetic fixtures.
- Assistant skill-assets and response-card authority suites: 58 cases passed.
  All seven new guidance journeys passed individually through
  `pnpm test:assistant:live -- --test "<exact case title>"` on `gpt-6-sol`
  using a local subscription. Every reply was reviewed Ready; canonical
  snapshots were unchanged and no automation or forbidden mutation occurred.
  Assistant Engine typecheck passed again after the final matcher edits.
- Billing workflow guard mutations: 39 cases passed. Test inventory and Vitest
  configuration helpers: three cases passed.
- `pnpm test:scenario-integrity`: passed for 206 scenarios, 12 sample inputs,
  and 29 golden-output directories.
- `pnpm complexity:diff --base HEAD`: passed; no new complexity debt. The
  pre-existing provider-boundary guard hotspot is unchanged.
- `pnpm docs:drift`, whitespace, reference, and authored-content privacy
  checks passed.

## Verification scope

No production changes, Docker image build, remote CI, deployment, or push.
Browser tests mock the product-search network boundary; bundle publication uses
synthetic executable artifacts with the real filesystem pipeline. These prove
their composed local boundaries, not external-provider or managed-container
operation.

## Outcome

Completed the four parallel audits, scoped removals, replacement journeys,
current documentation/CI references, parent review, and local verification.
The isolated PostgreSQL database created for this task was removed after the
retained SQL/report suites passed. The worktree remains available with its
scoped commit; no PR, remote push, or production action was requested.

Live verification initially encountered unavailable subscription homes before
provider action. The documented local-home fallback succeeded without reading
or copying credentials. Two new reply checks needed semantic corrections:
recognize an actually reduced race-week schedule and environmental stress
reduction, and distinguish a warning against missed-run catch-up from advice
to do it. The corrected cases passed on the same working subscription.
Completed: 2026-10-21
