# Test-only source code invariant

Status: completed
Created: 2026-06-03
Updated: 2026-06-03

## Goal

- Add a baseline invariant that production/source code should not accumulate
  branches, exports, helpers, routes, fixtures, or seams that exist only for
  test harnesses.

## Success criteria

- `docs/contracts/00-invariants.md` states the rule plainly.
- The rule points tests toward better options such as fixtures, test support
  modules, and narrow production seams with real runtime value.
- The docs-only fast-path readback passes.

## Scope

- In scope:
- `docs/contracts/00-invariants.md`
- Out of scope:
- Runtime code, test harness code, package exports, scripts, or verification
  tooling.

## Constraints

- Technical constraints: keep the invariant simple and avoid new enforcement
  mechanics in this change.
- Product/process constraints: preserve existing repo workflow and privacy
  guardrails.

## Risks and mitigations

1. Risk:
   The invariant could accidentally forbid legitimate production observability
   or composition seams.
   Mitigation: phrase it around code that exists only for tests and allow
   narrow source seams when they carry real runtime/product ownership.

## Tasks

1. Add the invariant text.
2. Read back the touched docs and diff.
3. Close the plan and commit the scoped docs change.

## Decisions

- None yet.

## Verification

- Commands to run:
- Direct readback of `docs/contracts/00-invariants.md`.
- `git diff --check` for whitespace/privacy-safe diff hygiene.
- Expected outcomes:
- The invariant text is present and the diff has no whitespace errors.

## Verification results

- Passed: direct readback of `docs/contracts/00-invariants.md`.
- Passed: `git diff --check -- docs/contracts/00-invariants.md agent-docs/exec-plans/active/2026-06-03-test-only-source-invariants.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
- Ran `pnpm typecheck`; it failed in an unrelated hosted-web dirty lane because `apps/web/scripts/seed-hosted-active-linq-member.ts` and `apps/web/scripts/seed-hosted-active-member.ts` import the currently deleted `apps/web/src/lib/hosted-onboarding/hosted-member-test-seed.ts`.
- Ran `pnpm test`; it failed in an unrelated assistant-runtime dirty lane because `packages/assistant-runtime/src/hosted-runtime/codex-config.ts` imports the currently missing `./codex-e2e-app-server-stub.ts`.
Completed: 2026-06-03
