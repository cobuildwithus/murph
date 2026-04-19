# Restore `apps/web` Vercel build after hosted-wake hard-cut drift

Status: completed
Created: 2026-04-19
Updated: 2026-04-19

## Goal

- Restore a truthful passing `apps/web` production build for the current dirty tree by fixing the hosted-wake/export drift that currently breaks Vercel.

## Success criteria

- `pnpm --dir apps/web build` succeeds in the current tree, or any remaining failure is proven unrelated to the touched fix.
- The fix stays limited to the hosted-wake/export surface implicated by the Vercel error.
- Any changed tests or route assertions stay aligned with the hard-cut execution-fetch contract.

## Scope

- In scope:
- `apps/web/src/lib/hosted-wake/{payload,store}.ts`
- `apps/web/app/api/internal/hosted-wake/unseen/route.ts`
- `packages/hosted-execution/src/index.ts` only if a shared-package re-export fix is required
- Focused `apps/web` hosted-wake tests only if the current assertions drifted from the intended contract
- Out of scope:
- Broader hosted-wake materialization/finalize/recovery work
- Unrelated `apps/web` onboarding, device-sync, or Cloudflare runner changes already in flight

## Constraints

- Preserve overlapping dirty-tree edits in the same owners.
- Match the current hard-cut contract: executable wake fetches use the committed cursor only and do not accept legacy payload-schema imports or stale route exports.
- Do not broaden shared-package compatibility surfaces just to mask a caller bug.

## Verification

- passed: `pnpm --dir apps/web build`
- passed: `pnpm --dir apps/web typecheck`
- passed: `pnpm --dir ../.. exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-wake-routes.test.ts apps/web/test/hosted-wake-store.test.ts apps/web/test/hosted-wake-payload-unification.test.ts --no-coverage`
- attempted but unrelated red: `pnpm test:diff apps/web/src/lib/hosted-wake/payload.ts apps/web/src/lib/hosted-wake/store.ts apps/web/app/api/internal/hosted-wake/unseen/route.ts apps/web/test/hosted-wake-routes.test.ts apps/web/test/hosted-wake-store.test.ts`
  - unrelated pre-existing workspace boundary failure: `packages/assistantd/src/http-protocol.ts` imports `@murphai/operator-config/assistant-cli-contracts` without a direct dependency declaration
  - unrelated pre-existing `apps/web` verify failure: `apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts` fails because `HostedMemberRouting` now includes `replyAliasLookupKey`

## Notes

- The Vercel log specifically reported stale imports of `HOSTED_WAKE_CONVERSATION_MESSAGE_PAYLOAD_SCHEMA`, `HOSTED_WAKE_SYSTEM_PAYLOAD_SCHEMA`, and `listHostedWakesAfterSeq`. The current worktree already contains part of that cleanup, so local verification must confirm the remaining failure before patching.
- The minimal production fix for the logged Vercel failure is the current dirty-tree diff in:
  - `apps/web/src/lib/hosted-wake/payload.ts`
  - `apps/web/app/api/internal/hosted-wake/unseen/route.ts`
Completed: 2026-04-19
