# Changelog and hosted product feedback

Status: completed
Created: 2026-06-22
Updated: 2026-06-22

## Goal

- Land the supplied changelog and hosted product-feedback patch on an isolated PR branch, resolve drift against current `main`, ask `cc2` for UI improvements, and carry the result through repo-required verification, audits, PR creation, and ReviewGPT PR review.

## Success criteria

- Changelog feed/page/card routes work against validated static changelog data.
- Hosted product-feedback records can flow from assistant runtime tooling through hosted execution, Cloudflare web-control allowlisting, and the web-owned persistence route without widening secret or authority boundaries.
- Accepted `cc2` UI improvements are integrated without expanding the backend scope.
- Required tests, typecheck, app/package verification, completion audits, and ReviewGPT PR rounds pass or have documented unrelated blockers.

## Scope

- In scope:
  - Supplied patch files under `apps/web`, `apps/cloudflare`, `packages/hosted-execution`, `packages/assistant-engine`, `packages/assistant-runtime`, and `packages/runtime-state`.
  - Minimal drift fixes required for current `main`.
  - UI polish for the new changelog surfaces.
- Out of scope:
  - Broad product-feedback analytics, admin dashboards, notification flows, or extra changelog automation.
  - Refactors outside touched call paths unless required by review or verification.

## Constraints

- Technical constraints:
  - Keep hosted web as the durable product-feedback persistence owner.
  - Keep Cloudflare as a thin runner/web-control proxy, not a product-state owner.
  - Do not expose feedback text, prompts, secrets, raw headers, user identifiers, or local paths in logs, docs, fixtures, PR artifacts, or review bundles.
- Product/process constraints:
  - Follow the repo PR lane: active plan, scoped commit through `scripts/finish-task`, draft PR, and external ReviewGPT PR rounds.
  - Preserve Murph's calm, scientific, non-gamified UI language.

## Risks and mitigations

1. Risk: Product-feedback plumbing crosses hosted runtime, Cloudflare, hosted execution, and web persistence boundaries.
   Mitigation: Keep contracts narrow, validate route policy, run security/privacy review, and verify focused tests plus broader repo checks.
2. Risk: The supplied patch was generated against a slightly stale `main`.
   Mitigation: Apply with three-way fallback, inspect every conflict, and favor existing current-main ownership patterns over patch shape.
3. Risk: New changelog UI could drift from the design system.
   Mitigation: Use `cc2` for a UI pass, run frontend review, and verify responsive browser behavior where feasible.

## Tasks

1. Apply supplied patch on `codex/changelog-feedback`.
2. Resolve patch drift and inspect the full resulting diff.
3. Ask `cc2` for UI improvements focused on the changelog surfaces.
4. Integrate accepted UI improvements and any necessary tests.
5. Run required verification and completion audits.
6. Close the active plan with a scoped commit, push, and open a draft PR.
7. Run ReviewGPT PR rounds to zero accepted findings.

## Decisions

- Use a fresh temporary worktree so the main checkout and unrelated task worktrees remain untouched.
- Treat this as high-risk/cross-cutting because it adds persisted hosted feedback and hosted runtime/tool plumbing, not just a static changelog page.

## Verification

- Commands to run:
  - Focused tests for changelog/product-feedback surfaces as available.
  - `pnpm typecheck`.
  - `pnpm test:diff <touched paths>` or `pnpm verify:acceptance` if scoped coverage is not truthful enough.
  - Browser verification for the new changelog UI where feasible.
  - Completion audits: `security-privacy-review`, `frontend-review`, `coverage-write`, and likely `deep-review` due cross-boundary scope.
  - ReviewGPT PR loop after push.
- Expected outcomes:
  - Required commands pass, or unrelated pre-existing failures are documented with direct evidence.
  - No unresolved accepted audit or ReviewGPT findings remain.
Completed: 2026-06-22
