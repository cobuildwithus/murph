# Publish the July 26–27 changelog

Status: completed
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Bring the public `/changelog` archive forward from its July 25 cutoff with
  evidence-backed July 26 and July 27 editions that explain shipped member
  behavior in Murph's existing product register.

## Success criteria

- The two newest dated editions cover the material user-facing changes merged
  after the last changelog update without publishing internal-only work,
  withdrawn behavior, or unsupported claims.
- The default archive window remains seven dated editions, stable item
  permalinks and edition cursors keep working, and archive metadata previews
  the new leading items.
- The production edition layout is reusable and the design catalog renders the
  real section against synthetic changelog data.
- Focused tests, canonical verification, responsive browser proof, required
  product/frontend reviews, and PR checks pass.

## Scope

- In scope:
  - `apps/web/src/lib/changelog.ts`
  - the changelog edition presentation and `/changelog` composition
  - a sections-tab design study with synthetic data
  - focused changelog and design-catalog tests
- Out of scope:
  - changing shipped product behavior
  - rewriting historical editions
  - publishing internal operations, infrastructure, or withdrawn Sunday
    group-automation behavior
  - changing authentication, billing, consent, or messaging runtime owners

## Constraints

- Ground every entry in merged code, current product contracts, or completed
  execution-plan evidence.
- Keep provider and internal architecture terminology out of visible copy.
- Preserve the warm editorial archive design, seven-edition pagination, stable
  anchors, and current try-it behavior.
- Reuse the existing edition markup rather than introducing a second design-only
  implementation.

## Risks and mitigations

1. Risk: public copy overstates a backend or companion capability.
   Mitigation: include only behavior with a completed current-state contract and
   phrase recovery or reliability work at the user-visible boundary.
2. Risk: adding two dates silently shifts archive cursor expectations.
   Mitigation: update focused registry, page, permalink, pagination, and
   metadata assertions.
3. Risk: extracting the edition section changes presentation or try-it actions.
   Mitigation: move the existing markup without redesign, preserve the visual
   and resolved-action inputs, and compare focused server-rendered output.

## Tasks

1. Audit merged changes after the July 25 changelog cutoff and select only
   current user-facing behavior.
2. Add July 26 and July 27 editions with stable ids, source PRs, relevance tags,
   and honest feature/improvement copy.
3. Extract the existing edition section as a reusable production component and
   render it with synthetic data in the design catalog.
4. Update focused tests and run canonical diff verification.
5. Capture desktop and mobile design proof, complete product/frontend/Claude
   reviews, and resolve accepted findings.
6. Commit, push, open the PR, run the preliminary specialist review, confirm CI
   and mergeability, then close the plan for handoff.

## Decisions

- Use one dated edition per calendar date to preserve the archive's established
  release-note model.
- Treat the July 25 edition publication as the cutoff. Include changes that
  became part of `main` after that edition's authored head, and do not recast
  earlier already-merged July 25 work.
- Omit the removed Sunday superlatives automation and operations-only growth,
  deployment, migration, observability, and review-tooling work.

## Verification

- Focused changelog and design-catalog Vitest coverage.
- `git diff --check`
- `pnpm test:frontend-design-proof`
- canonical `pnpm test:diff ...`
- `pnpm verify:acceptance`
- desktop and phone browser proof on `/changelog` and the changelog design
  study
- product-experience review, Claude UI double-check, preliminary frontend and
  coverage ReviewGPT lenses, and parent final review

## Completion evidence

- Focused changelog and design-catalog coverage passed: 32 tests.
- Canonical `pnpm test:diff ...` passed after specialist remediation and the
  merge with current `main`: 552 web test files, 6,867 tests, lint with zero
  errors, dev smoke, typecheck, and production build.
- Repo-wide acceptance passed every changed and web owner. One untouched
  Cloudflare cancellation test timed out only under the composed run; its full
  file passed alone, 13/13 in 3.86 seconds. An earlier untouched setup-wizard
  failure also cleared on the acceptance rerun.
- Desktop, tablet, and phone browser proof passed for `/changelog`; desktop and
  phone catalog proof render the real production section with synthetic data.
- Product-experience review passed with no findings after remediation. The
  preliminary specialist finding about a live registry import was accepted and
  resolved by making the permalink builder explicit.
- The Claude UI double-check was attempted and stopped on explicit usage-credit
  exhaustion.
Completed: 2026-07-27
