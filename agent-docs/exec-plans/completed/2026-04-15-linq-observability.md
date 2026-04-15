# Linq Observability Cleanup

## Goal

Make Linq delivery failures diagnosable from one structured, redacted diagnostic shape across the shared Linq client, hosted onboarding sends, and hosted runtime finalize/reconciliation paths.

## Why

- Current Linq failures are often reduced to short messages before they reach hosted runner logs.
- Hosted web Linq sends and runtime Linq sends use different error/logging shapes.
- The runner logs lifecycle phases, but it often lacks the Linq-specific fields needed to explain why typing started and delivery never completed.

## Scope

- `packages/operator-config/**`
- `packages/hosted-execution/**`
- `packages/assistant-runtime/**`
- `apps/web/src/lib/hosted-onboarding/**`
- `apps/web/test/**`

## Constraints

- Keep all new diagnostics safe for logs: no message bodies, phone numbers, chat ids, bearer tokens, or user-identifying paths.
- Prefer one canonical detail shape over adding more free-form log lines.
- Improve boundary logging rather than scattering provider logs through low-level helpers.
- Preserve unrelated worktree edits, including the dirty hosted first-contact lane and `apps/web/src/components/hosted-onboarding/join-invite-copy.ts`.

## Plan

1. Extend shared hosted-execution error-detail extraction so structured logs can consume both `details` and provider/client `context`.
2. Enrich the shared Linq runtime client with canonical safe diagnostic fields on request failures.
3. Add the same safe diagnostic fields to hosted onboarding Linq errors and log them once at the webhook side-effect boundary.
4. Attach assistant-delivery effect/journal context to hosted runtime finalize errors and Linq typing warnings.
5. Add focused tests in the touched owners, then run required verification and land with a scoped commit.

## Verification Target

- `pnpm typecheck`
- coverage-bearing owner/app commands for touched owners if the diff-aware lane is not the truthful minimal lane in this workspace

## Outcome

- Added one safe canonical Linq diagnostic shape in `packages/operator-config` and propagated it through hosted execution, hosted runtime, and hosted onboarding boundaries without editing the active first-contact routing lane.
- Added one reverse-dependent CLI expectation update so the shared Linq error contract remains asserted where downstream callers consume it.

## Verification Result

- Passed: `pnpm typecheck`
- Passed: `pnpm --dir ../.. exec vitest run packages/cli/test/assistant-channel.test.ts --config packages/cli/vitest.workspace.ts --no-coverage --project cli-assistant`
- Passed: `pnpm --dir packages/operator-config exec vitest run test/http-linq-device-runtime.test.ts test/http-linq-device-runtime-branches.test.ts --config vitest.config.ts --no-coverage`
- Passed: `pnpm --dir packages/hosted-execution exec vitest run test/hosted-execution-observability-side-effects.test.ts --config vitest.config.ts --no-coverage`
- Passed: `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-callbacks.test.ts test/hosted-runtime-typing.test.ts --config vitest.config.ts --no-coverage`
- Passed: `pnpm --dir ../.. exec vitest run apps/web/test/hosted-onboarding-linq-transport.test.ts --config apps/web/vitest.workspace.ts --no-coverage --project hosted-web-onboarding-integrations`
- Passed with warnings only: `pnpm --dir apps/web lint`
- Scoped diff-aware verification reached the shared reverse dependents and then failed for a pre-existing unrelated package issue in `packages/operator-config/test/device-daemon-runtime.test.ts`
Status: completed
Updated: 2026-04-15
Completed: 2026-04-15
