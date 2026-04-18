## Goal (incl. success criteria)

Move the remaining live `apps/web` lifecycle usage in the requested web-owned slice off the dispatch-lifecycle shim and onto the canonical wake lifecycle/materialization surface without changing behavior.

Success criteria:
- Targeted `apps/web/src/lib/**` modules import wake-native helpers directly instead of `hosted-execution/dispatch-lifecycle`.
- Directly related `apps/web` tests/mocks stop importing or mocking the dispatch-lifecycle shim.
- Any safe dispatch-era local naming in the touched slice is updated to wake-native terminology without semantic changes.
- Focused `apps/web` verification passes for the touched surface complete.

## Constraints/Assumptions

- Scope stays limited to `apps/web/src/lib/**` and directly related `apps/web` tests.
- Preserve unrelated dirty worktree edits and ongoing hosted pricing/onboarding/wake work.
- Do not widen into UI, manifests, or shared package contract changes.
- Treat behavior as fixed; this is cleanup only.

## Key decisions

- Leave the shim file alone unless the targeted slice fully stops depending on it and removal is clearly non-overlapping.
- Prefer direct imports from `hosted-execution/wake-lifecycle` or `hosted-wake/*` instead of adding another compatibility layer.
- Rename only obviously local dispatch-era identifiers in touched files when the rename improves clarity and does not broaden the diff.

## State

in_progress

## Done

- Read repo workflow docs, verification guidance, testing map, and active coordination ledger.
- Audited the remaining `apps/web` shim consumers and confirmed they are limited to the requested lib/tests slice.
- Switched the targeted `apps/web` lifecycle consumers and directly related tests to wake-native imports.
- Removed the unused `apps/web/src/lib/hosted-execution/dispatch-lifecycle.ts` shim after confirming no live `apps/web` imports remained.
- Ran targeted Vitest coverage for the touched slice plus `apps/web` typecheck and lint.

## Now

- Final diff sanity check, then scoped commit and handoff.

## Next

- Commit the touched slice with the closed plan artifact.
- Hand off the verification results, including the unrelated `test:diff` smoke blocker caused by an invalid Privy app ID in the current environment.

## Open questions (UNCONFIRMED if needed)

- None.

## Working set (files/ids/commands)

- Plan: `agent-docs/exec-plans/active/2026-04-18-web-wake-lifecycle-cleanup.md`
- Target modules: `apps/web/src/lib/device-sync/wake-service.ts`, `apps/web/src/lib/hosted-onboarding/{activation-progress,member-activation,member-channel-sync,webhook-provider-linq,webhook-provider-telegram,webhook-service}.ts`, `apps/web/src/lib/hosted-share/{acceptance-service,shared}.ts`
- Target tests: directly related `apps/web/test/**` plus `apps/web/src/lib/hosted-share/shared.lifecycle.test.ts`
- Verification run:
- `pnpm --dir apps/web test -- test/device-sync-hosted-wake-dispatch.test.ts test/hosted-onboarding-member-activation.test.ts test/hosted-onboarding-member-channel-sync.test.ts test/hosted-onboarding-linq-dispatch.test.ts test/hosted-onboarding-telegram-dispatch.test.ts test/hosted-onboarding-webhook-idempotency.test.ts test/hosted-share-service.test.ts test/hosted-wake-dispatch.test.ts src/lib/hosted-share/shared.lifecycle.test.ts`
- `pnpm --dir apps/web typecheck`
- `pnpm --dir apps/web lint`
- `bash scripts/workspace-verify.sh test:diff <touched apps/web files>` failed after re-running `apps/web verify` because `apps/web dev:smoke` could not boot with the current invalid Privy app ID; the earlier targeted Vitest/typecheck/lint steps passed.
Status: completed
Updated: 2026-04-18
Completed: 2026-04-18
