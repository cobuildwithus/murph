# Biomarker design components

Status: completed
Created: 2026-07-21
Updated: 2026-07-21

## Goal

- Add a polished biomarker index and biomarker detail study to the dedicated
  `/design?tab=sections` tab so the member-facing information hierarchy can be
  reviewed in-browser before production adoption.

## Success criteria

- The Sections tab includes a grouped biomarker index study with concise
  status, latest-value, filter, disclosure, and direct-link affordances.
- The Sections tab includes a concise biomarker detail study with the latest
  result and reference-band history.
- Both studies follow `PRODUCT.md`, `DESIGN.md`, the measured-biomarker index
  contract, and the supplied visual references without changing production data
  ownership or medical interpretation.
- Desktop and phone layouts render without overflow and remain keyboard-usable.
- Focused tests, canonical verification, required frontend and coverage audits,
  and parent final review have no unresolved accepted findings. The required
  Claude Code UI check is attempted and any account-level blocker is recorded.

## Scope

- In scope:
  - `/design?tab=sections` biomarker showcase sections and local mock fixtures.
  - Reusable presentation-only biomarker study components under `apps/web`.
  - Focused component/page tests.
- Out of scope:
  - Production `/biomarkers` route behavior, query selectors, browser-vault data,
    health-area classification, persistence, auth, or medical copy contracts.
  - New dependencies, design-system replacements, charts that imply unsupported
    time-series facts, or changes to production navigation.

## Constraints

- Technical constraints:
  - Use the existing Next 16, Tailwind v4, Base UI/shadcn, and Lucide stack.
  - Keep the studies presentation-only with static, explicitly fictional data.
  - Use deliberately round synthetic values and dates that do not mirror a
    member's saved lab history.
  - Prefer flat paper surfaces, warm hairlines, semantic tokens, and restrained
    native/CSS state transitions.
- Product/process constraints:
  - Preserve curated-area disclosure semantics from the measured-biomarker
    index contract while keeping device readings out of this lab-only study.
  - Treat numbers as clues rather than verdicts; sienna is reserved for genuine
    out-of-range state and sage for affirmative state.
  - Preserve unrelated working-tree and ledger edits; complete through the
    isolated worktree workflow.

## Risks and mitigations

1. Risk: A visual prototype accidentally looks like production medical truth.
   Mitigation: Keep it under `/design`, use local static fixtures, and avoid
   diagnosis, severity, or recommendations.
2. Risk: The reference layout becomes a dense desktop-only table.
   Mitigation: Use structural breakpoint changes, full-row tap targets, and
   direct phone-width browser proof.
3. Risk: The prototype duplicates production data ownership or classification.
   Mitigation: Keep data local to the showcase and leave production selectors
   and routes untouched.

## Tasks

1. Audit the current components tab, installed primitives, biomarker production
   patterns, tests, and the two supplied reference screenshots.
2. Define the smallest reusable index and detail study APIs and implement them
   with static showcase fixtures.
3. Add the studies to the components tab and write focused behavioral and
   responsive-structure tests.
4. Run the design preflight, live user review, canonical verification, required
   audits, and resolve accepted findings.
5. Close the plan, create the scoped commit, reconcile with the latest upstream
   history, push directly to `main` per user direction, and leave the isolated
   web dev server running for user review.

## Decisions

- This is a product-interface study, not a landing page; Murph's existing design
  system remains the sole system.
- The supplied screenshots are references for hierarchy and density, not assets
  to copy or persist.
- Production biomarker behavior is deliberately excluded from this first pass.
- Per user direction, the design study covers saved lab biomarkers only and
  leaves the existing device-reading presentation entirely out of scope.

## Verification

- Commands to run:
  - Focused Vitest for the design page and new component studies.
  - `pnpm test:diff apps/web/app/design apps/web/src/components/<touched-path>`.
  - Live user review through the isolated app-local dev server and a direct HTTP
    route check; record the unavailable automated-browser backend honestly.
  - `git diff --check` plus explicit privacy/identifier readback.
- Expected outcomes:
  - Focused and canonical checks pass.
  - No horizontal overflow, clipped labels, misleading chart state, inaccessible
    disclosure controls, dead link seams, or unresolved audit findings remain.

## Verification results

- Focused ESLint and the biomarker design-study Vitest file passed with four
  tests, including dedicated-tab routing and interactive Review filtering.
- The live `/design?tab=sections` route returned HTTP 200; iterative user review
  was completed against the app-local development server.
- `git diff --check` and the identifier/privacy scan passed. The example values,
  dates, history points, and reference bounds are deliberately round synthetic
  fixtures and the prior real-looking values are absent from the task files.
- Frontend and coverage audits returned no unresolved findings. The repository's
  Claude UI check was attempted but could not run because the configured account
  had no model credits.
- Both canonical verification commands were attempted but could not acquire the
  exclusive shared-host slot because an unrelated checkout was already running
  `apps/web verify`; this task's waiting processes were stopped cleanly before
  commit.
Completed: 2026-07-21
