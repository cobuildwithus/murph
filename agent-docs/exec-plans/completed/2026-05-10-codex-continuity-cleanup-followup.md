# Codex Continuity Cleanup Follow-up

## Goal

Land the remaining Codex continuity cleanup fixes on `codex/codex-continuity-cleanup` so stale Codex resume fallback starts fresh threads with bootstrap/developer instructions, canonical Codex resume state is resumable only when route fingerprinted, and hosted snapshot continuity behavior is explicit for old broken records.

Success criteria:

- Stale `thread/resume` fallback calls fresh `thread/start` with non-null fresh-thread developer/bootstrap instructions.
- Canonical `codexResume` normalizes to `null` unless both thread id and route fingerprint are present.
- Hosted snapshot scanner does not treat thread-id-only raw assistant session records as resumable continuity.
- Focused tests and required checks pass or any unrelated blocker is named.
- Commit only scoped continuity files, leaving unrelated dirty Cloudflare runner edits untouched.

## Constraints

- Preserve unrelated dirty worktree edits.
- Do not expose local usernames, home paths, secrets, prompts, transcripts, or raw vault data.
- Do not weaken hosted snapshot fail-closed behavior for truly resumable Codex state missing rollout files.
- Use `scripts/finish-task` for final scoped commit if safe.

## Working Set

- `packages/assistant-engine/src/assistant/provider-turn-runner.ts`
- `packages/assistant-engine/src/assistant/provider-turn/planning.ts`
- `packages/assistant-engine/src/assistant/providers/**`
- `packages/assistant-engine/src/assistant/turn-finalizer.ts`
- `packages/assistant-engine/test/codex-thread-instructions.test.ts`
- `packages/assistant-engine/test/assistant-protocol-index-planning.test.ts`
- `packages/operator-config/src/assistant/codex-resume-state.ts`
- `packages/operator-config/src/assistant-cli-contracts.ts`
- `packages/operator-config/test/assistant-session-resume-state.test.ts`
- `packages/operator-config/test/assistant-runtime-contracts-coverage.test.ts`
- `packages/runtime-state/src/hosted-bundles.ts`
- `packages/runtime-state/test/hosted-bundle.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-restore-codex-continuity.test.ts`

## State

Done:

- Confirmed branch has uncommitted P0 stale-resume fallback bootstrap fix.
- Confirmed branch has uncommitted canonical `codexResume` route-fingerprint normalization fix.
- Tightened hosted snapshot scanner so raw thread-id-only session files are ignored as non-resumable continuity.
- Added hosted-bundle regression coverage for legacy and v2 thread-id-only records.
- PASS: `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts test/codex-thread-instructions.test.ts test/assistant-protocol-index-planning.test.ts --no-coverage`
- PASS: `pnpm --dir packages/operator-config exec vitest run --config vitest.config.ts test/assistant-session-resume-state.test.ts --no-coverage`
- PASS: `pnpm --dir packages/runtime-state exec vitest run --config vitest.config.ts test/hosted-bundle.test.ts -t "Codex|thread-id-only|fixture policy" --no-coverage`
- PASS: `pnpm typecheck`
- FAIL then fixed: `bash scripts/workspace-verify.sh test:diff ...` exposed assistant-engine finalizer/provider-state regressions where successful turns produced null resume state after route fingerprint tightening.
- FAIL then fixed: rerun `bash scripts/workspace-verify.sh test:diff ...` exposed an assistant-runtime restore fixture that meant "resumable but incomplete" but only used a thread id.
- FAIL then fixed: rerun `bash scripts/workspace-verify.sh test:diff ...` exposed an operator-config fixture that expected resumable v1 continuity while setting `resumeRouteId: null`.
- PASS: `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts test/turn-finalizer.test.ts test/provider-seams.test.ts test/assistant-service-runtime.test.ts --no-coverage`
- PASS: `pnpm --dir packages/assistant-engine typecheck`
- PASS: `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-workspace-restore-codex-continuity.test.ts -t "incomplete legacy hot Codex resume state" --no-coverage`
- PASS: `pnpm --dir packages/assistant-runtime typecheck`
- PASS: `pnpm --dir packages/operator-config exec vitest run --config vitest.config.ts test/assistant-runtime-contracts-coverage.test.ts test/assistant-session-resume-state.test.ts --no-coverage`
- PASS: `pnpm --dir packages/operator-config typecheck`
- PASS: `pnpm test:smoke`
- PASS: `pnpm --dir packages/assistant-engine test:coverage`
- PASS: `pnpm --dir packages/assistant-runtime test:coverage`
- PASS: `pnpm --dir packages/operator-config test:coverage`
- PASS: `pnpm --dir packages/runtime-state test:coverage`
- BLOCKED by unrelated dirty Cloudflare runner work: `bash scripts/workspace-verify.sh test:diff ...` passed package guards/typechecks/tests through runtime-state package coverage scope, then failed in `apps/cloudflare verify` on `apps/cloudflare/test/user-runner-alarm.test.ts` deferred idle-checkpoint expectation from unrelated pending-nudge/deferred-checkpoint edits.
- PASS: final `pnpm typecheck`
- PASS with reconciliation: security/privacy audit reported thread-id-only Codex state still accepted, but current diff requires non-empty `routeFingerprint` in `codexResumeStateSchema`, returns `null` when route fingerprint is absent, and hosted bundle scanning ignores thread-id-only session records.
- PASS with reconciliation: coverage/finish audits reported missing stale-fallback and v2 missing-route tests, but current diff adds focused assertions in `packages/assistant-engine/test/codex-thread-instructions.test.ts` and `packages/operator-config/test/assistant-session-resume-state.test.ts`.

Now:

- Create scoped commit for continuity fixes.

Next:

- Handoff branch status, verification, and unrelated Cloudflare test blocker.
Status: completed
Updated: 2026-05-10
Completed: 2026-05-10
