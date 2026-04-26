# Codex Home Session Primitive

## Goal

Simplify the Codex home session-refresh fix so implicit conversation-key reuse is guarded by the existing provider continuity fingerprint primitive, without adding provider-specific policy plumbing to persistence.

## Scope

- `packages/assistant-engine/src/assistant/store.ts`
- `packages/assistant-engine/src/assistant/store/persistence.ts`
- `packages/cli/test/assistant-state.test.ts` only if coverage needs a direct assertion update

## Constraints

- Preserve explicit `sessionId` and alias resume behavior.
- Refresh only implicit conversation-key sessions when the requested provider continuity changes.
- Do not expose local account or home-directory identifiers in docs, tests, logs, or commits.
- Preserve unrelated dirty work in the shared checkout.

## Verification

- Focused assistant state regression test.
- Assistant engine focused store runtime test.
- Package-local typechecks for `assistant-engine` and `cli`.
- `git diff --check` for touched paths.

## State

- Done: Refactored the working fix around `continuityFingerprint`.
- Done: Focused assistant state regression, assistant-engine store runtime test, package-local typechecks, smoke test, scoped diff check, privacy scan, security/privacy review, coverage review, and task-finish review passed.
- Note: Diff-aware workspace verification reached `apps/cloudflare verify` and then failed on an unrelated Health Commons generated-content indentation issue.
- Now: Closing the plan and creating a scoped commit.
- Next: Handoff.
Status: completed
Updated: 2026-04-26
Completed: 2026-04-26
