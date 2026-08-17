# Simplify Product UX workflow and screenshot studies

Status: completed
Created: 2026-08-17
Updated: 2026-08-17

## Goal

- Replace repeated product-experience and frontend-review rules with one
  proportional Product UX workflow that plans value before code and replays the
  same journeys after code.
- Separate the public design reference from internal screenshot studies without
  adding another review gate.

## Success criteria

- `agent-docs/operations/product-ux.md` owns Product UX planning, walkthrough,
  review scope, evidence rules, and finding levels.
- The separate product-experience prompt and mandatory Claude/Fable UI
  double-check are removed from every live workflow owner and pinned test.
- Ordinary PRs use a short outcome, Product UX result, evidence, and changelog
  description. Risk details stay conditional on the path changed.
- `/design` keeps Brand, Components, and Consent. `/screenshots` groups real
  production studies into smaller unlinked, noindex pages.
- Frontend evidence is matched to the changed claim. It does not require a
  catalog edit or a screenshot count.
- Focused docs, script, route, type, and test checks pass.

## Scope

- In scope: current workflow docs and prompts, PR body guards, ReviewGPT packet
  ownership, `/design`, `/screenshots`, and direct tests or references that pin
  those contracts.
- Out of scope: product marketing context, production product behavior, moving
  every existing study file, pruning studies without usage evidence, and any
  push or PR update.

## Constraints

- Technical constraints: preserve changelog and high-risk invariant gates;
  preserve synthetic props, zero live requests, and `inert` controls in studies.
- Product/process constraints: add no new review pass; use zero, one, or many
  screenshots based on the claim; keep historical completed plans immutable.

## Risks and mitigations

1. Workflow owners or tests still point at removed rules.
   Mitigation: search all live references and update the matching validators and
   pinned assertions in the same change.
2. A short PR body hides trust-boundary risk from final ReviewGPT.
   Mitigation: keep risk, context-sensitivity, fanout, provider-input, and
   deployment details conditional when the changed path needs them.
3. `/screenshots` becomes a second product or leaks live data.
   Mitigation: keep it unlinked and noindex, render production components with
   synthetic props only, make controls inert, and perform no live requests.

## Tasks

1. Done: merge the useful product-experience review rules into Product UX and route
   the preliminary product lens to that owner.
2. Done: remove the mandatory second-model UI check and simplify completion and PR
   description rules.
3. Done: replace the design-catalog PR guard with a small frontend-evidence guard.
4. Done: remove Sections from `/design`; add grouped `/screenshots` pages and migrate
   direct study links.
5. Done: update live documentation, packaging, workflow checks, and pinned tests.
6. In progress: run focused verification, inspect the complete diff, and create a local
   scoped commit without pushing.

## Decisions

- Product UX effort follows the product promise: Patch, Product change, or
  Feature.
- Fable 5 is optional planning help for a genuinely important or complex
  Feature when it is available. It never blocks work and needs no report.
- `/design?tab=components` remains the reusable-component reference. New shared
  components should appear there, but CI does not force every UI diff to touch
  it.
- `/screenshots` proves presentation only. End-to-end value needs evidence from
  the real journey boundary.
- Final ReviewGPT remains an independent high-risk gate. Product UX alone does
  not trigger it.

## Verification

- Passed: `pnpm test:frontend-evidence`.
- Passed: `node --test scripts/check-pr-changelog.test.mjs`.
- Passed: focused Frog workflow guards.
- Passed: Product UX ownership assertions in the pinned CLI workflow test.
- Passed: the hosted Web screenshot-study test, including all seven categories,
  `inert` previews, the reduced `/design` tabs, and noindex metadata.
- Passed: documentation drift, formatting, and `git diff --check`.
- Broad repo-tools coverage: 567 tests passed. One unrelated suite could not load
  the missing local `@elevenlabs/elevenlabs-js` package.
- Full pinned CLI workflow coverage: 42 tests passed and one skipped. One
  unrelated assertion fails against the installed `@cobuild/review-gpt` driver
  because its prompt stage precedes its attachment stage.
- Hosted Web and CLI typechecks reached the changed files without errors, then
  stopped on missing local optional packages such as Composio, Google KMS,
  Resend, Exa, and ElevenLabs.
- Playwright route proof was not run because the local hosted runtime cannot
  load those missing packages. Static production-component rendering covers
  the route split without claiming live journey proof.
- Search proof: live workflow owners have no remaining references to the
  deleted product-experience prompt, mandatory Claude UI double-check, Sections
  design tab, catalog-touch guard, architecture-summary guard, or manual
  change-shape table. Historical Frog entries remain unchanged.
Completed: 2026-08-17
