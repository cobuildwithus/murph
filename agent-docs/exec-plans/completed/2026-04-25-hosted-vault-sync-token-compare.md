# Harden hosted vault-sync token comparison

Status: completed
Created: 2026-04-25
Updated: 2026-04-25

## Goal

- Harden hosted vault-sync agent session token validation by replacing direct hash string inequality with a constant-time comparison helper.

## Success criteria

- `requireHostedVaultSyncAgentSession` accepts the valid bearer token and rejects an invalid one without direct `!==` hash comparison.
- Focused hosted vault-sync coverage proves valid, invalid, and malformed stored hash behavior.
- Required security/privacy, coverage, and final review passes complete with no unresolved high-severity findings.
- Scoped verification for the touched hosted-web slice is green or any unrelated blocker is explicitly documented.

## Scope

- In scope:
  - `apps/web/src/lib/vault-sync/shared.ts`
  - Direct hosted vault-sync tests in `apps/web/test/vault-sync-session-service.test.ts`
- Out of scope:
  - Vault-sync session lifecycle changes, payload storage, retention cleanup, route behavior, Prisma schema changes, and hosted execution flow changes.

## Constraints

- Technical constraints:
  - Use built-in Node crypto APIs only.
  - Preserve existing error codes and status behavior.
  - Do not log or fixture real tokens, local paths, member identifiers, or payload contents.
- Product/process constraints:
  - Preserve unrelated dirty-tree work and existing active hosted-web rows.
  - Follow high-risk auth/trust-boundary workflow because this touches bearer-token validation.

## Risks and mitigations

1. Risk: Stored malformed hashes could make `timingSafeEqual` throw or accidentally change the public error shape.
   Mitigation: Length-check before comparison and cover malformed stored hashes with focused tests.
2. Risk: Focused verification can be obscured by unrelated dirty hosted-web work.
   Mitigation: Run narrow direct tests first and use scoped diff verification only for the touched files when broad dirty-tree fanout is not truthful.

## Tasks

1. Inspect existing vault-sync auth and tests.
2. Add a constant-time hash comparison helper.
3. Add focused tests for valid, invalid, and malformed hash cases.
4. Run direct verification plus required audit passes.
5. Close the plan and create a scoped commit if the commit can safely include only this task's files.

## Decisions

- Keep the helper local to `vault-sync/shared.ts` because no broader hosted-web hash-compare abstraction is needed for this one narrow seam.

## Verification

- Commands to run:
  - `pnpm exec vitest run apps/web/test/vault-sync-session-service.test.ts --config apps/web/vitest.config.ts --no-coverage`
  - `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/vault-sync/shared.ts apps/web/test/vault-sync-session-service.test.ts`
  - `pnpm typecheck`
  - `git diff --check -- apps/web/src/lib/vault-sync/shared.ts apps/web/test/vault-sync-session-service.test.ts agent-docs/exec-plans/active/2026-04-25-hosted-vault-sync-token-compare.md`
- Expected outcomes:
  - Focused tests and diff-aware app verification pass, unless unrelated existing dirty-tree blockers are documented.

## Progress

- Implemented a length-checked `crypto.timingSafeEqual` comparison helper for hosted vault-sync agent token hashes.
- Added focused auth coverage for valid token, wrong token, and malformed stored-hash length mismatch.
- Security/privacy review found the full vault-sync session-service test needed new synthetic payload-delete Prisma stubs because adjacent hosted-web retention work changed the production session-commit path; the stubs/assertions are now present.
- Focused vault-sync session-service test is green with 9 tests passing.
- Scoped `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/vault-sync/shared.ts apps/web/test/vault-sync-session-service.test.ts` is green, including hosted-web verify, tests, lint, dev smoke, and Next build.
- `pnpm typecheck` is red in unrelated untracked `apps/web/src/lib/hosted-onboarding/linq-typing-diagnostic.ts` numeric parsing/type narrowing code.
Completed: 2026-04-25
