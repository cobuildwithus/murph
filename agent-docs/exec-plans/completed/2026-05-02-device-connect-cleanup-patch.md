# Land device connect source cleanup patch

Status: completed
Created: 2026-05-02
Updated: 2026-05-02

## Goal

- Land the supplied device-connect cleanup patch so the `/connect` page starts OAuth by source id, keeps provider/connect-target internals server-side, carries callback source intent through OAuth state, and reflects a just-connected source on the callback render.

## Success criteria

- Patch intent is integrated without overwriting unrelated active checkout edits.
- Hosted connect API responses expose only `{ authorizationUrl: string }` to the browser.
- Source-centric route and existing provider route behavior are covered by focused tests.
- Required verification, completion audits, and scoped commit are completed or any unrelated blockers are documented.

## Scope

- In scope: `packages/device-syncd` connect-target/callback-state helpers, hosted web connect-start routes/services, `/connect` page source selection, and focused tests.
- Out of scope: Junction provider implementation, broad wearable source query policy, unrelated hosted encryption/onboarding/Health Commons dirty work, and generated catalog/export artifacts.

## Constraints

- Technical constraints: preserve Next.js App Router async route conventions, keep OAuth state/browser responses minimized, and keep source id to internal connect-target mapping server-side.
- Product/process constraints: follow the active ledger; preserve unrelated dirty work; use the repo completion workflow for auth/external-surface and user-facing `apps/web` changes.

## Risks and mitigations

1. Risk: The supplied patch is stale against current `/connect` page search/layout edits.
   Mitigation: Apply clean hunks mechanically, reconcile stale UI hunks manually, and inspect the final diff against the patch intent.
2. Risk: OAuth callback or connect-start changes could leak internal state or widen browser-visible authority.
   Mitigation: run security/privacy review, focused tests, and direct response-shape inspection.
3. Risk: Active overlapping connect-target/Junction rows may own related files.
   Mitigation: keep the change narrow and do not revert existing edits.

## Tasks

1. Apply the supplied patch where it cleanly applies.
2. Manually reconcile stale `/connect` page hunks against current source-search UI.
3. Inspect diff for privacy leaks, response shape, and source/connect-target boundaries.
4. Run focused tests and required repo verification.
5. Run required completion audit passes and address findings.
6. Finish with a scoped commit if the changed files can be safely isolated.

## Decisions

- Use a plan-bearing high-risk path because the patch touches OAuth state, public routes, and user-facing hosted UI.
- Do not use a simplify pass because this is a bounded externally supplied patch landing.
- Preserve source intent on callback error redirects after state consumption so Junction-backed source failures keep the user-facing source label instead of falling back to the internal provider label.

## Verification

- Passed: `pnpm exec vitest run apps/web/test/device-sync-callback-route.test.ts apps/web/test/connect-page.test.ts apps/web/test/device-sync-settings-routes.test.ts --config apps/web/vitest.config.ts --no-coverage`
- Passed: `pnpm exec vitest run test/connect-targets.test.ts test/public-ingress.test.ts test/config.test.ts --config vitest.config.ts --no-coverage` from `packages/device-syncd`
- Passed: `pnpm typecheck`
- Passed: `pnpm --dir apps/web lint`
- Passed: `pnpm --dir packages/device-syncd test:coverage`
- Passed: `git diff --check`
- Attempted before the final source-intent fix: `pnpm verify:acceptance`; failed on unrelated repo-wide issues already present outside this task lane: missing core audit fixture `audit/2026/2026-04.jsonl`, hosted-execution export-list drift, setup-cli WHOOP callback wording, and documented scenario manifest mismatch for `vault-cli device connect` syntax.

## Review

- Security/privacy review: no blocking findings.
- Frontend review: found callback error redirects for Junction-backed sources could show the internal provider label; fixed by carrying `connectSourceId` / `connectTarget` through callback error details and redirect params.
- Coverage-write: added connected callback render and source-id target lookup assertions.
- Task-finish review: no blocking findings; residual risk is that source intent cannot be recovered when failure happens before a valid OAuth state is consumed.
Completed: 2026-05-02
