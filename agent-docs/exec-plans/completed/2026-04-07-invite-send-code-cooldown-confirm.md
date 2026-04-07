## Goal (incl. success criteria):
- Remove the remaining stranded-user cooldown edge in hosted invite send-code by starting the durable cooldown only after the server confirms the send succeeded.
- Keep prepare/confirm/abort semantics aligned with the client retry model: `prepare` mints a short-lived attempt id, `confirm` durably records the cooldown and clears attempt markers, and `abort` only clears the transient attempt markers.
- Success means the server no longer persists `signupPhoneCodeSentAt` during prepare, the focused hosted-onboarding tests cover the new contract, and scoped verification passes.

## Constraints/Assumptions:
- Preserve unrelated dirty-tree edits, especially the active hosted privacy, webhook, billing, and runtime lanes.
- Keep the current invite send-code cooldown policy and retry windows unchanged apart from when the durable timestamp is written.
- Do not broaden this into a larger onboarding refactor; stay inside the invite phone-code lifecycle seam.

## Key decisions:
- Treat `signupPhoneCodeSendAttemptId` and `signupPhoneCodeSendAttemptStartedAt` as short-lived prepare-stage state only.
- Move the durable `signupPhoneCodeSentAt` write to `confirmHostedInvitePhoneCode`.
- Leave `abortHostedInvitePhoneCode` responsible only for clearing transient attempt markers for the current attempt.

## State:
- in_progress

## Done:
- Read the required routing, architecture, verification, reliability, completion-workflow, and testing docs.
- Re-read the hosted invite send-code implementation and focused test coverage.
- Registered the task in the coordination ledger.
- Moved the durable `signupPhoneCodeSentAt` write from `prepareHostedInvitePhoneCode` to `confirmHostedInvitePhoneCode`.
- Updated the focused hosted-onboarding invite send-code and member-service tests to lock the new prepare/confirm/abort contract.
- Verified the touched seam with a direct Vitest invocation covering the invite send-code lifecycle.

## Now:
- Close the plan artifact and create the scoped commit.

## Next:
- None.

## Open questions (UNCONFIRMED if needed):
- None.

## Working set (files/ids/commands):
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-04-07-invite-send-code-cooldown-confirm.md`
- `apps/web/src/lib/hosted-onboarding/invite-service.ts`
- `apps/web/test/hosted-onboarding-invite-send-code.test.ts`
- `apps/web/test/hosted-onboarding-member-service.test.ts`
- `pnpm typecheck`
- `pnpm --dir apps/web lint`
- `pnpm --dir apps/web test -- --run apps/web/test/hosted-onboarding-invite-send-code.test.ts apps/web/test/hosted-onboarding-member-service.test.ts`
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-onboarding-invite-send-code.test.ts apps/web/test/hosted-onboarding-member-service.test.ts`

## Verification:
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-onboarding-invite-send-code.test.ts apps/web/test/hosted-onboarding-member-service.test.ts` (passed)
- `pnpm --dir apps/web lint` (passed with pre-existing warnings only)
- `pnpm typecheck` (failed on unrelated pre-existing workspace errors in `packages/core/src/vault.ts` and `packages/assistant-engine/src/usecases/{integrated-services,workout-measurement,workout-model}.ts`)
- `pnpm --dir apps/web test -- --run test/hosted-onboarding-invite-send-code.test.ts test/hosted-onboarding-member-service.test.ts` (script expanded to the wider hosted-web lane and failed on unrelated pre-existing hosted webhook/billing/Linq suites outside the invite seam)

## Direct proof:
- The direct invite lifecycle proof now shows `prepare` writing only attempt markers, `confirm` writing the durable cooldown timestamp, and `abort` clearing only the transient attempt state for the current attempt.

Status: completed
Updated: 2026-04-07
Completed: 2026-04-07
Completed: 2026-04-07
