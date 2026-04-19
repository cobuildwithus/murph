## Title

Extract explicit hosted wake start-mode and failure-recovery helpers from `RunnerWakeProcessor.executeWake`.

## Goal

Keep the current hosted wake lifecycle behavior intact while making the entry decision explicit: already-finalized reuse, resume-from-pending-commit, or direct run. Isolate the transient failure-recovery branch so future lifecycle changes do not stay interleaved inside one large method.

## Scope

- `apps/cloudflare/src/user-runner/runner-wake-processor.ts`
- focused Cloudflare hosted-wake tests only where needed for regression proof

## Constraints

- Preserve the current DO-local pending-commit seam and cursor-cleanup semantics.
- Do not change wake ordering, lease ownership, retry scheduling, or pending-commit persistence behavior.
- Keep the refactor local to `RunnerWakeProcessor`; avoid new cross-file abstractions unless required for proof.
- Preserve existing already-finalized reuse and resume-after-commit behavior.

## Verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner/runner-wake-processor.ts apps/cloudflare/test/user-runner-hosted-wake.test.ts apps/cloudflare/test/user-runner.test.ts apps/cloudflare/test/user-runner-finalize-cas-conflict.test.ts`

## Notes

- The intended extraction is behavioral cleanup, not a lifecycle redesign.
- Regression proof should cover direct execution, DO-local pending-commit resume, already-finalized reuse, and transient failure recovery preserving pending-commit retry state.
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
