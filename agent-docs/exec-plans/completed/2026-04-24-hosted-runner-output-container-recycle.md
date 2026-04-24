# Recycle hosted runner containers after invalid output bundles

Status: completed
Created: 2026-04-24
Updated: 2026-04-24

## Goal

- Stop retry loops where a warm hosted runner container keeps returning an invalid runner-output bundle archive.
- Keep the fix narrow: no DB reset flow, no R2 deletion, no cursor mutation, no bundle format change.

## Success criteria

- Explicit `runner-output` hosted bundle validation errors destroy the named warm runner container before the existing retry path schedules another attempt.
- Invalid authoritative input snapshots still use the existing quarantine path and are not retried.
- Regression coverage proves runner-output validation remains retryable but recycles the container.

## Scope

- In scope:
- `apps/cloudflare/src/user-runner/runner-run-processor.ts`
- `apps/cloudflare/test/runner-run-processor.test.ts`
- this active plan and `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Out of scope:
- R2 bundle cleanup
- DB/signup/onboarding state mutation
- Hosted bundle archive schema changes
- New operational reset endpoints

## Constraints

- Preserve unrelated dirty-tree work, including the active digital-sunset research lane.
- Do not log secrets, raw contact identifiers, local paths, or provider payloads.
- Keep runner-output failures on the normal retry path; only recycle the warm container as best-effort lifecycle cleanup.

## Verification

- Passed: `pnpm --dir apps/cloudflare typecheck`.
- Passed: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runner-run-processor.test.ts -t "recycles the warm container before retrying explicit runner-output bundle validation failures" --no-coverage`.
- Passed: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runner-run-processor.test.ts --no-coverage`.
- Passed: `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner/runner-run-processor.ts apps/cloudflare/test/runner-run-processor.test.ts agent-docs/exec-plans/active/2026-04-24-hosted-runner-output-container-recycle.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
- Passed: `git diff --check -- apps/cloudflare/src/user-runner/runner-run-processor.ts apps/cloudflare/test/runner-run-processor.test.ts agent-docs/exec-plans/active/2026-04-24-hosted-runner-output-container-recycle.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
- Required coverage-write audit reported no test changes needed after the ordering assertion was added.
- Required task-finish-review audit found no issues.

## Outcome

- `runner-output` hosted bundle archive validation failures now destroy the named warm runner container before the normal fail/retry path continues.
- The existing invalid authoritative input quarantine remains unchanged.
- No DB state, R2 objects, hosted cursors, bundle archive schema, or reset endpoint was changed.
Completed: 2026-04-24
