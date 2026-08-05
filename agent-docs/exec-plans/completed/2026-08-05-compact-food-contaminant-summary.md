# Expose exact-label contaminant evidence in compact food lookup

Status: completed
Created: 2026-08-05
Updated: 2026-08-05

## Goal

- Make every default compact food-label lookup expose bounded contaminant test
  evidence for the exact selected label while preserving the fast, small meal
  nutrition response introduced by the current PR.

## Success criteria

- Compact results retain serving, calories, protein, carbohydrate, fat, and
  fiber and add an exact-label contaminant summary.
- The summary distinguishes known linked tests from no known linked tests,
  names a bounded set of observations and comparable alerts, and declares
  truncation when more evidence exists.
- No linked test evidence remains explicitly unknown and is never presented as
  proof that a food is clean or safe.
- `--full-label` retains the complete current label and contaminant response.
- Focused route, query, CLI-schema, prompt-contract, and type checks pass, and
  exact-head CI plus the required ReviewGPT gates are clean.

## Scope

- In scope: the private food-label lookup query path, compact response
  projection/schema, CLI contract, food-journal model guidance, focused tests,
  and deployment documentation if the additive response changes rollout order.
- Out of scope: supplement lookup behavior, public product pages, new
  contaminant ingestion, safety verdicts, new persistence, or a second evidence
  owner.

## Constraints

- Technical constraints: reuse the existing `product_tests` exact-label join
  and threshold scorer; keep the compact response bounded; do not expose the
  complete source label or complete lab record; preserve the existing
  `nutritionOnly` wire flag for rolling compatibility.
- Product/process constraints: health evidence must be cautious and
  evidence-specific; absence of linked observations is unknown; update the
  existing PR through the worktree lane and complete prompt/product/coverage
  specialist review plus the final runtime review gate.

## Risks and mitigations

1. Risk: adding contaminant evidence reintroduces the oversized response that
   caused the latency incident.
   Mitigation: project only counts, status, a small observation/alert subset,
   and essential source/threshold facts; assert a strict synthetic size bound.
2. Risk: a missing test is interpreted as a negative result or safety claim.
   Mitigation: retain the canonical `no_known_product_tests`/`unknown` values,
   add explicit model guidance, and test the empty-evidence projection.
3. Risk: contaminant evidence is attached through a broad or fuzzy match.
   Mitigation: reuse only the existing exact selected-label association and
   verify the product-test query is executed for the selected search result.
4. Risk: Web and the hosted CLI deploy out of order.
   Mitigation: keep the new compact field additive and optional in the CLI
   parser, document Web-first rollout, and verify old full-label behavior.

## Tasks

1. [x] Inspect the current compact projection, contaminant owner, response parser,
   model guidance, and focused test coverage.
2. [x] Add a bounded compact contaminant projection backed by the existing exact
   product summary and route default food searches through that owner.
3. [x] Extend the CLI schema and food-journal guidance so Murph reads the default
   evidence correctly and requests `--full-label` only for deeper detail.
4. [x] Add focused regression, size-bound, absence-is-unknown, and compatibility
   tests; run relevant tests and type checks.
5. [x] Push the exact candidate head, run required specialist/final ReviewGPT and
   CI gates, resolve findings, perform the parent review, and close the plan.

## Decisions

- Keep `nutritionOnly` as the rolling-compatible wire name even though its
  response now includes a compact contaminant summary; renaming the mode would
  create needless deploy skew.
- Put the additive compact evidence in `contaminantSummary`, leaving
  `contaminants` as the full-label field so both contracts remain unambiguous.
- Preserve the existing scorer's bounded `screeningPolicy` so unlike-unit
  measurements and daily-exposure thresholds remain intelligible without a
  full-label lookup.
- Delete the duplicate compact-search callback and use the canonical food
  search owner before optional projection.
- Attribute the reported measurement to its source, but attribute concern,
  exposure, and ratio to Murph's comparison with the named threshold authority.
  A threshold screen is not a source conclusion, product-safety verdict, or
  personalized risk assessment.
- Continue through one explicit post-cap verification round because the
  round-five correction tightened only the existing prompt owner and tests;
  reverting would preserve a known health-evidence provenance error.

## Verification

- Commands to run: focused Vitest files for food queries/routes/CLI/prompt
  policy, Web and CLI/assistant type checks selected from the repository map,
  a synthetic compact-output byte measurement, exact-head GitHub Actions, and
  required ReviewGPT passes.
- Expected outcomes: contaminant evidence appears in default GET and batch
  results, an untested item reports unknown, large label and lab payloads are
  absent, output remains within the asserted bound, full-label output is
  unchanged, and every required check is green.

## Completion evidence

- Web compact food library and route tests: 82 passed.
- CLI food-label and typed-parity tests: 26 passed.
- Food-journal prompt contracts: 4 passed after the attribution correction.
- Pinned App Server mixed-meal scenario: passed with unknown evidence,
  truncated exact-product evidence, named measurement source, named threshold
  authority, fixed screening assumptions, and no full-label lookup.
- Web, CLI, and assistant-engine typechecks: passed; scoped Web ESLint and
  `git diff --check`: passed.
- Synthetic compact projection: below 3,000 characters with a 500,000-character
  unrelated label field while retaining calories, nutrients, bounded evidence,
  screening context, provenance, and truncation.
- Privacy scan: no member identifier, screenshot wording, local username, or
  home-directory path in the task diff.
- Exact correction-head PR CI: 13 checks passed, one skipped, none failed.
- Preliminary specialist findings were resolved without a patch artifact.
  Final ReviewGPT round 6 returned `ROUND_OUTCOME: PASS` and
  `REVIEW_COMPLETE` on the corrected head after the recorded hard-cap
  continuation decision.
- The round-six base note was rejected: GitHub's PR API identifies the PR base
  used for the change-shape counts, while the cited local tracking snapshot was
  unrelated and had no merge base with the task head.
Completed: 2026-08-05
