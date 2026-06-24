# Codex Auth Review Fixes

Status: completed
Created: 2026-06-23
Updated: 2026-06-23

## Goal

Fix accepted ReviewGPT findings for the hosted Codex ChatGPT auth checkpoint PR.

## Success Criteria

- Device-code login timeout allows a realistic human auth window.
- Fresh connect/disconnect retries can re-signal the already committed mailbox
  wake.
- Disconnect failures remain distinguishable and retryable in the settings UI.
- Hosted Codex managed auth JSON validation has one canonical parser.
- Focused tests, typecheck, diff checks, docs drift, and web verification pass or
  any unrelated failures are explicitly identified.

## Scope

- In scope:
  - Hosted Codex ChatGPT auth store, settings API route, and settings UI state.
  - Codex managed account login timeout.
  - Hosted Codex subscription auth parser ownership and package path maps.
  - Focused tests for the review fixes.
- Out of scope:
  - New auth providers.
  - New runtime queues or reconciliation services.
  - Broad settings redesign.

## Constraints

- Preserve the existing hosted-execution public import path.
- Keep the fix small and composable; use the existing mailbox dedupe key rather
  than adding another retry mechanism.
- Do not expose secrets, direct user identifiers, local account names, or home
  paths in committed files or handoff text.

## Risks And Mitigations

1. Risk: A retryable disconnect error could strand an active credential.
   Mitigation: Recover the existing mailbox item id from its deterministic
   dedupe key and re-signal it on fresh retries; preserve a disconnect-specific
   error state that renders a retryable Disconnect action.
2. Risk: Moving the auth parser could break existing callers.
   Mitigation: Make runtime-state the parser owner and keep hosted-execution as
   a compatibility re-export at the current subpath.

## Tasks

1. Validate ReviewGPT findings against the current branch.
2. Patch the timeout, retry signaling, action-specific errors, and parser
   ownership.
3. Add focused coverage for retry and error-state behavior.
4. Run focused and required verification.
5. Close this plan with the scoped commit.

## Decisions

- Use `connect_error` and `disconnect_error` persisted states rather than a
  second table or retry queue.
- Keep legacy generic `error` readable as a connect failure for compatibility.
- Keep the hosted-execution parser path as a re-export so downstream imports do
  not change.

## Verification

- Passed:
  - `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/hosted-chatgpt-settings.test.tsx apps/web/test/hosted-codex-auth-store.test.ts apps/web/test/settings-chatgpt-route.test.ts apps/web/test/hosted-codex-auth-internal-route.test.ts`
  - `pnpm --dir packages/runtime-state exec vitest run --no-coverage test/package-boundary.test.ts test/hosted-bundle.test.ts`
  - `pnpm --dir packages/hosted-execution exec vitest run --no-coverage test/hosted-execution.test.ts test/hosted-runtime-control.test.ts`
  - `pnpm --dir packages/assistant-runtime exec vitest run --no-coverage test/hosted-runtime-events-coverage.test.ts test/hosted-runtime-system-mailbox-notification.test.ts`
  - `pnpm typecheck`
  - `pnpm test:diff`
  - `pnpm --dir apps/web verify`
  - `pnpm docs:drift`
  - `git diff --check`

## Audit Results

- Security/privacy review: no medium-or-higher findings.
- Frontend review: accepted the retryable disconnect-runtime-failure UI finding;
  fixed with `disconnect_error` local state and focused component coverage.
  Frontend rerun found no findings.
- Deep review: reported the same retry re-signal and generic error-state issues
  already fixed in this plan.
- Coverage-write: added focused settings-row proof for retryable connect runtime
  failures rendering `Connection failed`.
Completed: 2026-06-23
