# Hosted verified email sync into hosted execution

Status: completed
Created: 2026-03-27
Updated: 2026-03-27

## Goal

- Extend the hosted `/settings` email-verification flow so a Privy-verified email is pushed into hosted user env and reconciled onto the hosted assistant's saved email self-target.
- Keep the behavior aligned with the existing hosted control-plane boundaries: the browser verifies via Privy, `apps/web` verifies the server-side Privy identity token and hosted session, hosted execution stores only operational user env state, and the runtime reconciles the saved target during hosted runs.

## Success criteria

- `POST /api/settings/email/sync` requires a hosted session, verifies the `privy-id-token`, rejects Privy/hosted-session mismatches, extracts a verified email from linked accounts, and writes the hosted verified-email env via the hosted execution control client.
- The `/settings` client flow retries the sync route briefly after OTP verification to tolerate short-lived Privy cookie lag and surfaces clear success/error states.
- Hosted execution env helpers can create/read the verified-email env pair and the shared hosted-execution env reader exposes the control base URL plus control token.
- Hosted runtime reconciliation maps the private hosted verified email onto the assistant email self-target, preferring `email:agentmail` and otherwise requiring exactly one enabled email connector.
- Focused tests cover the sync route, control helper, verified-email env helpers, Privy linked-account parsing, and runtime reconciliation.

## Scope

- In scope:
  - hosted settings email sync route and client retry UX
  - hosted execution control helper for verified-email env writes plus best-effort run trigger
  - shared env/runtime helpers for hosted verified email projection
  - focused tests and minimal env/docs updates required by the new flow
- Out of scope:
  - broader hosted onboarding refactors
  - generic self-target reconciliation for non-email channels
  - Cloudflare control-plane API changes beyond already-supported user env/run endpoints

## Constraints

- Preserve adjacent dirty hosted onboarding, hosted bootstrap, and runtime-state work already in the tree.
- Keep sibling-package imports on declared public entrypoints only; do not reach into another package's `src/` or `dist/`.
- Treat hosted user env and Privy identity material as sensitive operational state; do not log secrets or raw cookies.

## Risks and mitigations

1. Risk: the browser verifies the OTP before the server-side Privy identity token reflects the new verified email.
   Mitigation: keep the sync route retryable on `PRIVY_EMAIL_NOT_READY` and add a short bounded client retry window.
2. Risk: runtime reconciliation could bind the verified email to the wrong email connector when multiple connectors exist.
   Mitigation: prefer `email:agentmail`, otherwise require exactly one enabled email connector and no-op privately when ambiguous.
3. Risk: patch drift against the live tree could violate workspace-boundary or dirty-tree constraints.
   Mitigation: adapt stale hunks to current exports/tests rather than applying the patch blindly, and preserve unrelated edits.

## Tasks

1. Add the hosted sync route plus client-side retry flow in `apps/web`.
2. Add the hosted execution control helper and shared hosted verified-email env utilities.
3. Reconcile the hosted verified email onto the assistant self-target during hosted runtime execution.
4. Add focused tests and run required verification plus mandatory audit passes.

## Outcome

- Implemented the hosted verified-email sync route, client retry handling, hosted execution control helper, hosted verified-email env utilities, and hosted runtime email self-target reconciliation.
- Added focused coverage for the sync route, control helper, Privy linked-account parsing, hosted verified-email env helpers, runtime reconciliation, and current hosted control-client parser expectations.
- Required audit passes completed: `simplify` found no actionable issues, `test-coverage-audit` found no actionable issues, and `task-finish-review` surfaced one stale hosted-execution test expectation that was updated.

## Verification

- Passed: `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-execution-control.test.ts apps/web/test/settings-email-sync-route.test.ts apps/web/test/hosted-onboarding-privy-shared.test.ts --no-coverage --maxWorkers 1`
- Passed: `pnpm exec vitest run packages/hosted-execution/test/hosted-execution.test.ts --no-coverage --maxWorkers 1`
- Passed: `pnpm exec vitest run packages/runtime-state/test/hosted-user-env.test.ts packages/assistant-runtime/test/hosted-email-route.test.ts --no-coverage --maxWorkers 1`
- Failed outside this lane: `pnpm typecheck`
  - current blocker is the dirty `packages/cli` lane, including unresolved `@murph/*` module-resolution/type errors during the workspace build.
- Failed outside this lane: `pnpm test`
  - current blocker is the repo doc-drift guard reporting dirty `agent-docs` changes outside generated artifacts despite the scoped `agent-docs/index.md` update.
- Failed outside this lane: `pnpm test:coverage`
  - current blocker is the same dirty `packages/cli` workspace build failure reached through the coverage wrapper.
