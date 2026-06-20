# PR 225 ReviewGPT Round 7 Fix

## Goal

Resolve the accepted ReviewGPT round 7 finding for PR 225: hosted email
managed automations must be seeded when the hosted route has an explicit
hosted email delivery target and no usable local sender identity.

## Constraints

- Preserve local validation defaults for managed automation seeding.
- Make hosted-vs-local route validation explicit and reusable.
- Do not reintroduce ad hoc optional-boolean drift across write/execution
  boundaries.
- Keep the fix narrow to managed automation creation and route validation.

## Working Set

- `packages/assistant-engine/src/assistant/cron/targets.ts`
- `packages/assistant-engine/src/assistant/managed-automations.ts`
- `packages/assistant-engine/test/managed-automations-core.test.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts`

## Verification Plan

- Add focused regression for hosted identityless explicit email managed
  automation seeding.
- Run focused managed-automation tests.
- Run focused hosted workspace assistant-phase tests if the hosted call shape
  changes.
- Run affected package typechecks.
- Run scoped `test:diff` over touched files.

## Verification Results

- Focused hosted email managed-automation regression passed.
- Full `managed-automations` test files passed.
- Focused route-adjacent assistant cron runtime tests passed.
- Full hosted workspace assistant-phase test file passed.
- Affected package typechecks passed.
- Root `pnpm typecheck` passed.
- Scoped `test:diff` over touched files passed, including Cloudflare verify.
- `git diff --check` passed.
- Diff privacy scan passed.
- Coverage audit found no blocker gaps.
- Security/privacy/trust-boundary audit found no Critical/High/Medium findings.
Status: completed
Updated: 2026-06-19
Completed: 2026-06-19
