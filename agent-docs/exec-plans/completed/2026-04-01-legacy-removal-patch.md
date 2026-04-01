# Land legacy compatibility removal patch

Status: completed
Created: 2026-04-01
Updated: 2026-04-01

## Goal

- Land the supplied legacy-compatibility removal patch across hosted device-sync, assistant-core/CLI imports, hosted onboarding webhook decoding, and Cloudflare crypto read paths without disturbing unrelated in-flight edits.

## Success criteria

- The dead hosted device-sync start-route alias, legacy chat-provider shim, `VAULT_ROOT` env alias, backfill script, plaintext webhook fallback, and ciphertext rewrite-on-read branch are removed.
- Remaining callers and tests are updated to the supported paths and env names.
- Required verification passes after the post-review fixes, or any unrelated pre-existing failure is documented with direct evidence.
- The active coordination-ledger row and this plan are closed as part of completion.

## Scope

- In scope:
- Port the supplied legacy-removal patch intent onto the current tree.
- Apply post-review fixes so invalid legacy webhook payloads fail closed and managed child envs do not inherit `VAULT_ROOT`.
- Re-run required verification and direct scenario checks affected by the review fixes.
- Out of scope:
- Prisma migration-history squashing.
- The old-row `recipientPhoneMask` fallback in `apps/web/src/lib/linq/prisma-store.ts`.
- Assistant-state legacy secret-repair flows.

## Constraints

- Technical constraints:
- Preserve unrelated dirty-tree edits across the repo and avoid broad cleanup.
- Keep changes behavior-preserving except where the patch explicitly removes compatibility-only fallbacks.
- Product/process constraints:
- Use a scoped commit containing only the patch landing files.
- Close the plan before commit via the repo’s plan-aware finish flow.

## Risks and mitigations

1. Risk: A removed compatibility path may still be exercised by stale callers or persisted legacy data.
   Mitigation: Update remaining imports/callers, add targeted regression coverage, and fail closed on unsupported legacy webhook payloads.
2. Risk: Verification may be obscured by the broad dirty worktree.
   Mitigation: Use the active plan required by the repo guard, run targeted checks alongside repo-wide checks, and commit only the exact touched paths.

## Tasks

1. Finalize the patch landing and post-review fixes on top of the current tree.
2. Re-run repo-wide required verification plus focused scenario tests for the changed boundaries.
3. Remove the coordination-ledger row, close the plan, and create a scoped commit.

## Decisions

- Treat the user-supplied patch as behavioral intent and merge only the intended legacy-removal delta onto the live tree.
- Fail closed on legacy plaintext `linq_message_send` payloads instead of silently dropping them.
- Strip inherited `VAULT_ROOT` from the managed device-sync child env so only `DEVICE_SYNC_VAULT_ROOT` remains supported.

## Verification

- Commands to run:
- `pnpm --dir apps/web lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- `pnpm --dir apps/web exec vitest run test/hosted-onboarding-webhook-receipt-transitions.test.ts --config vitest.workspace.ts --no-coverage`
- `pnpm --dir packages/device-syncd exec vitest run test/config.test.ts --config vitest.config.ts --no-coverage`
- Expected outcomes:
- Commands pass, except for the pre-existing `apps/web` lint warnings already present in this tree.
- Focused webhook and device-sync env regressions prove the post-review fixes directly.
- Results:
- `pnpm --dir apps/web lint` passed with the same 17 pre-existing warnings and no errors.
- `pnpm typecheck` passed.
- `pnpm test` passed.
- `pnpm test:coverage` passed.
- `pnpm --dir apps/web exec vitest run test/hosted-onboarding-webhook-receipt-transitions.test.ts --config vitest.workspace.ts --no-coverage` passed after seeding the legacy plaintext payload directly.
- `pnpm --dir packages/device-syncd exec vitest run test/config.test.ts --config vitest.config.ts --no-coverage` passed.
Completed: 2026-04-01
