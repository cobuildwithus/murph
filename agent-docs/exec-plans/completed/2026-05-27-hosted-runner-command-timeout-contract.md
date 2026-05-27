# Hosted Runner Command Timeout Contract

## Goal

Make the hosted runner `ensureRuntimeProcessing` foreground path return
`accepted` or `retry_later` before the Temporal caller's existing HTTP timeout.

Success criteria:

- Temporal sends its existing ensure-processing HTTP timeout to Cloudflare as
  command metadata, without changing the timeout amount.
- Cloudflare uses that caller timeout as the outer foreground command budget.
- Existing Cloudflare step timeouts remain the per-step caps, but workspace read
  and readiness confirmation are additionally capped by the remaining command
  budget.
- If the budget is exhausted before accepted, Cloudflare clears the owned fresh
  fence and returns `retry_later`.
- Focused tests prove the timeout header handoff and the slow-prep retry path.

## Constraints

- Do not add a new timeout knob or change existing timeout amounts.
- Preserve deploy-skew tolerance: older Cloudflare deployments must ignore the
  new metadata instead of rejecting the request body.
- Preserve metadata-only logging; do not log raw workspace payloads, secrets,
  headers, local paths, or account identifiers.
- Preserve the async runtime completion boundary.

## Plan

1. Add an internal command-timeout header to the Temporal Cloudflare request.
2. Read and validate that header in the Cloudflare ensure-processing route.
3. Add a small foreground command budget helper in `HostedUserRunner`.
4. Cap workspace read and readiness confirmation by the remaining budget.
5. Add focused tests and run required verification/audits.

## Verification

- `git diff --check` passed.
- `pnpm --dir apps/cloudflare typecheck` passed.
- `pnpm --dir packages/hosted-execution typecheck` passed.
- `pnpm --dir packages/hosted-orchestrator-temporal typecheck` passed.
- `pnpm --dir packages/hosted-execution test -- hosted-orchestration-control.test.ts temporal-env.test.ts`
  passed: 21 files, 141 tests.
- `pnpm --dir packages/hosted-orchestrator-temporal test -- ensure-runtime-processing.test.ts`
  passed: 12 files, 101 tests.
- `pnpm --dir apps/cloudflare test:node -- user-runner-alarm.test.ts index.test.ts`
  passed: 80 files, 1162 tests.
- `bash scripts/workspace-verify.sh test:diff ...` over the touched files passed
  before concurrent unrelated websocket edits. A later rerun is blocked by an
  unrelated `packages/assistant-engine/src/assistant/providers/helpers.ts`
  `supportsWebSockets` type error from a separate dirty task.
- Security/privacy review found no findings.
- Simplify review found two low-severity cleanup items; both were applied.
- Coverage/proof pass added invalid-timeout route regression coverage.
- Follow-up regressions cover absent timeout metadata deploy skew, reserved
  unsigned-header rejection, active wake budget exhaustion, replacement start
  budget carryover, and slow runner-secret reads before acceptance.
Status: completed
Updated: 2026-05-27
Completed: 2026-05-27
