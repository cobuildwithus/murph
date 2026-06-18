# PR 213 ReviewGPT Round 3 Fixes

Status: completed
Created: 2026-06-18
Updated: 2026-06-18

## Goal

- Resolve accepted ReviewGPT round-3 correctness findings for PR 213 with narrow fixes.

## Success Criteria

- Blank provider output is not treated as an explicit `finish_without_reply` decision.
- Final no-reply turns do not hide failed, queued, or sent preceding delivery work.
- Focused tests, scoped verification, commit/push, and the next ReviewGPT round complete.

## Scope

- In scope: final-action classification, local send result delivery selection, auto-reply no-reply terminal classification, and focused regression tests.
- Out of scope: broad deletion of reaction plumbing without a replacement channel adapter decision.

## Constraints

- Preserve explicit `finish_without_reply` as the only no-text terminal action.
- Keep the fix in existing assistant runtime boundaries; no new persistent state or migration.
- Keep ReviewGPT artifacts under `audit-packages/` uncommitted.

## Risks And Mitigations

1. Risk: provider anomalies can be mistaken for intentional no-reply.
   Mitigation: require explicit final action metadata before returning `kind: none`.
2. Risk: no-reply final action can mask preceding delivery work.
   Mitigation: propagate preceding failure and surface preceding sent/queued outcomes as delivery work.

## Tasks

1. Patch explicit no-reply detection for blank provider output.
2. Patch preceding delivery handling when final action is none.
3. Add focused regression tests.
4. Run verification, commit, push, and continue ReviewGPT loop.

## Decisions

- Accepted ReviewGPT round-3 high findings for blank provider output and preceding delivery masking.
- Deferred the repeated complexity-collapse suggestion to delete all reaction plumbing because this PR intentionally keeps reaction tools unadvertised until channel support exists, and the accepted findings are narrower correctness bugs.

## Verification

- `pnpm --dir packages/assistant-engine typecheck` passed.
- `pnpm --dir packages/assistant-engine test -- assistant-local-service-runtime.test.ts assistant-codex-runtime.test.ts assistant-automation-runtime.test.ts codex-runtime-helpers.test.ts codex-thread-instructions.test.ts` passed.
- `bash scripts/workspace-verify.sh test:diff` passed.
Completed: 2026-06-18
