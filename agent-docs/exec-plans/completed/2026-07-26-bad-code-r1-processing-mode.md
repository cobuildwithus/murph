# Bad-code round 1: preserve hosted processing mode

Status: completed
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Remove the duplicate hosted invocation-request parser that silently drops the canonical `processingMode` field at the Cloudflare container boundary.

## Success criteria

- The assistant-runtime boundary delegates to the canonical hosted-execution parser.
- Supported processing modes survive JSON-to-runtime parsing unchanged, and unsupported values still fail closed.
- The obsolete request-only parsing helpers are deleted.
- Focused tests, canonical verification, preliminary specialist review, final ReviewGPT, and required PR checks pass.

## Scope

- In scope: the assistant-runtime hosted parser, the narrow Cloudflare transport boundary, and focused regression tests.
- Out of scope: mailbox scheduling, processing-mode semantics, hosted runtime orchestration, and unrelated parser or transport refactors.

## Constraints

- Keep hosted-execution as the one owner of the invocation-request contract.
- Preserve removed-field rejection, budget validation, nullable identifiers, and all current defaults.
- Prefer delegation and deletion; add no dependency, compatibility layer, or new state owner.
- Keep this batch isolated from later bad-code campaign rounds and do not merge its PR.

## Risks and mitigations

1. Risk: delegation could change an unrelated validation detail.
   Mitigation: compare the existing duplicate parser with the canonical parser and retain focused invalid-input coverage.
2. Risk: a unit-only assertion could miss the real JSON container boundary.
   Mitigation: add transport-level proof that a non-default mode reaches the runtime request.
3. Risk: overlapping hosted-runtime work could be overwritten.
   Mitigation: edit only the registered parser and focused tests in this isolated worktree.

## Tasks

1. Ask the same `bad-code` ReviewGPT thread for a minimal patch against this exact checkout.
2. Inspect the proposed patch, implement only verified intent, and add boundary regression coverage.
3. Run focused and canonical verification, then inspect the diff for privacy and unrelated changes.
4. Commit, push, open a stacked campaign PR, and complete preliminary specialist plus final ReviewGPT/CI gates.
5. Close the plan with the final scoped commit and leave the PR unmerged.

## Decisions

- Treat the first discovery as verified because the canonical parser retained `system_mailbox` while the actual container parser produced no `processingMode`.
- Preserve the public assistant-runtime parser export while delegating its implementation to the canonical hosted-execution owner.
- Build later campaign rounds on the fully reviewed preceding branch so each PR remains a small, independently reviewable batch without merging earlier work.

## Verification

- Direct pre-fix parser probe: reproduced the defect; the canonical parser retained `system_mailbox` while the Cloudflare container parser omitted `processingMode`.
- `pnpm exec vitest run packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`: passed, 237 tests.
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runner-job-transport.test.ts --no-coverage`: passed, 1 test.
- `MURPH_VERIFY_EXECUTOR=crabbox pnpm test:diff packages/assistant-runtime/src/hosted-runtime/parsers.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts apps/cloudflare/test/runner-job-transport.test.ts`: passed on a one-shot Testbox; assistant-runtime typecheck plus 1,892 tests passed, and Cloudflare typecheck plus 1,929 tests passed.
- Preliminary `completion-specialists` ReviewGPT: `SPECIALIST_OUTCOME: PASS`; prompt and frontend lenses were not applicable, the coverage lens passed with no findings, and no patch artifact was returned.
- Final parent review: passed; the canonical parser owns all request validation, the assistant-runtime export delegates without changing its public surface, the Cloudflare container uses that export, and the restored mode controls the existing bounded retention/system branches.
- Final canonical `MURPH_VERIFY_EXECUTOR=crabbox pnpm test:diff ...` rerun: passed on a fresh one-shot Testbox with the same 1,892 assistant-runtime and 1,929 Cloudflare test results.
- Final ReviewGPT and exact-head PR checks: pending until after plan closure and the resulting push.
Completed: 2026-07-26
