# Finish Vitest concurrency hardening

Status: completed
Created: 2026-03-31
Updated: 2026-03-31

## Goal

- Finish the partial Vitest hardening rollback so repo-owned suites keep file-level parallelism but treat in-file suite concurrency as opt-in, and make the helper/doc surfaces match that policy.

## Success criteria

- `config/vitest-parallelism.ts` defaults suite concurrency to off unless the env override explicitly enables it.
- CLI tests using `packages/cli/test/local-parallel-test.ts` follow the same default instead of silently re-enabling local suite concurrency.
- Durable verification/testing docs describe suite concurrency as opt-in by default while preserving the existing env override knobs.
- Required verification and audit passes complete, or any unrelated pre-existing failures are clearly isolated.

## Scope

- In scope:
- finish the narrow patch landing already present in the worktree for fragile test suites
- reconcile the remaining helper/config/doc drift around suite-concurrency defaults
- run required verification and complete the standard audit workflow
- Out of scope:
- broader Vitest bucket reshaping or additional fragile-suite hunts beyond the current hardening lane
- unrelated dirty-tree edits in assistant-core, gateway-core, or other active lanes

## Constraints

- Technical constraints:
- preserve file-level Vitest parallelism and the existing `MURPH_VITEST_*` / `MURPH_TEST_*` override knobs
- preserve unrelated worktree edits and avoid overwriting adjacent changes in already-dirty files
- Product/process constraints:
- keep durable docs truthful in the same change when the verification policy changes
- use scoped commit helpers rather than a broad manual commit if files are changed

## Risks and mitigations

1. Risk: mixed defaults leave some suites still running concurrently inside one file, creating flaky shared-global collisions.
   Mitigation: update the remaining helper wrapper and re-check the current sequentialized suite set against the supplied patch.
2. Risk: doc drift continues to advertise the previous locally-concurrent default.
   Mitigation: patch both verification docs in the same turn and verify the changed phrasing directly.
3. Risk: unrelated dirty worktree edits make the landing look larger than it is.
   Mitigation: keep the diff narrow, preserve existing edits, and use a scoped commit path after verification.

## Tasks

1. Reconcile any remaining helper/doc drift after the partially landed supplied patch.
2. Keep the active lane state accurate while audit and commit-closeout finish.

## Decisions

- Reuse the existing env overrides and keep file-level parallelism on; only the in-file suite-concurrency default changes.
- Treat the currently sequentialized suites as the intended narrow fragile-suite set for this lane instead of broadening the search.

## Verification

- Commands to run:
- None pending before commit unless review-driven fixes require reruns.
- Expected outcomes:
- `pnpm typecheck` passed.
- `pnpm test` passed.
- `pnpm test:coverage` passed.
Completed: 2026-03-31
