# Hide exact usage-credit balance from Settings

Status: completed
Created: 2026-07-23
Updated: 2026-07-23

## Goal

- Remove the exact purchased usage-credit dollar balance from the Settings
  included-usage summary while preserving the truthful distinction between
  included usage exhaustion with credit remaining and exhaustion with no
  capacity left.

## Success criteria

- The included-usage band never renders an exact usage-credit amount or the
  `usage credit remaining` line.
- Positive purchased credit still selects the existing
  `Murph will use your remaining usage credit` exhausted-state explanation.
- Zero or invalid purchased credit still selects the existing no-capacity
  explanation and available top-up action.
- The production component is exercised on the Settings design-catalog section
  at desktop and mobile widths.
- Focused tests, frontend design proof, canonical Web verification, required
  product/frontend reviews, and the parent final diff review pass.

## Scope

- In scope:
  - Settings billing presentation and its focused tests.
  - The real-component Settings design-catalog study.
  - Current hosted-usage product specs and their index description.
- Out of scope:
  - Usage-credit accounting, settlement, eligibility, offers, Checkout,
    refunds, disputes, or runtime admission.
  - Home, assistant, Family, group-funding, and operator usage behavior.
  - Database schemas, APIs, or deploy boundaries.

## Constraints

- Technical constraints:
  - Keep Web as the sole billing and usage projection owner.
  - Retain only the smallest boolean interpretation needed for honest
    exhausted-state copy; do not add state or another projection.
- Product/process constraints:
  - Preserve the Add usage flow and the included-usage percentage.
  - Keep the change in an isolated worktree and follow the frontend PR proof
    and review workflow.

## Risks and mitigations

1. Risk: Removing the exact amount also erases the signal that purchased credit
   remains after included usage is exhausted.
   Mitigation: Keep the existing server-projected balance input only as a
   positive-credit predicate for the exhausted-state explanation, with focused
   positive, sub-cent, zero, and invalid-value tests.

## Tasks

1. Remove the exact amount presentation and delete its formatting-only helper.
2. Update focused rendering tests and the Settings design-catalog study.
3. Align the current hosted-usage product specs and index.
4. Run focused and canonical verification, capture desktop/mobile catalog
   evidence, and complete required product/frontend reviews.
5. Commit, push, open the PR, run the preliminary specialist pass, perform the
   parent final review, close the plan, and finish required PR gates.

## Decisions

- The balance remains a private Web-side presentation input only to distinguish
  whether exhausted included usage can fall through to purchased credit. The
  exact monetary value is no longer user-facing in this summary.

## Verification

- Focused hosted billing and design-catalog tests: 45 passed.
- `pnpm test:frontend-design-proof`: 9 passed.
- Canonical `pnpm test:diff` over the touched Web and product-spec paths:
  6,258 tests passed, 154 skipped; typecheck, lint, dev smoke, and production
  build passed. Existing unrelated lint and build warnings remained warnings.
- `pnpm verify:acceptance`: passed.
- Desktop and mobile `/design?tab=sections` proof captured for active credit,
  exhausted included usage with credit remaining, and exhausted included usage
  without credit.
- Product-experience review: no findings after the three states were rendered
  at both viewports.
- Frontend double-check: no findings through the approved Opus fallback after
  the preferred Fable lane reported exhausted usage credits.
- Preliminary ReviewGPT specialist pass: `SPECIALIST_OUTCOME: PASS`, no
  findings, no coverage patch.
- Focused viewport-overflow proof: the three-state study passed at 768px and
  1,280px after the catalog E2E expectation was aligned with the rendered
  states. Two cold-server attempts timed out during an unrelated Turbopack
  workflow-directive compile; the production route returned 200 and both tests
  passed once the route was warmed in the same owned server session.
- Hosted design-proof upload is unavailable because the required local
  Cloudflare Images credential is not configured, and both the connected
  Cloudflare API identity and the existing Wrangler session lack Images write
  authorization. The redacted local captures remain in the ignored audit path
  for review packaging.
Completed: 2026-07-23
