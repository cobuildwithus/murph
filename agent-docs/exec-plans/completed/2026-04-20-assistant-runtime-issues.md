# Land supplied assistant-runtime issue privacy patch

Status: completed
Created: 2026-04-20
Updated: 2026-04-21

## Goal

- Land the supplied assistant-runtime privacy/issues patch without broadening it beyond the described hosted/local diagnostics, reply sanitization, runtime-state issue export, and hosted-web storage slices.
- Keep the implementation aligned with the repo's assistant-runtime storage, hosted control-plane, and privacy boundaries.

## Success criteria

- Hosted runtime final responses strip accidental visible `[DEV]` notes before persistence and delivery.
- Assistant runtime captures bounded structured issue records from runtime/provider failures without persisting raw sensitive payloads.
- Hosted runtime can export sanitized pending issue records through the runtime platform to hosted web.
- Hosted web accepts and stores exported issue rows in the new `HostedAssistantRuntimeIssue` table without linking them to a member record.
- Required verification is recorded, and the change lands as a scoped commit without disturbing unrelated dirty-tree work.

## Scope

- `packages/assistant-engine/src/assistant/{issue-reporting,local-service,provider-turn-runner,reply-sanitizer,system-prompt}.ts`
- `packages/assistant-engine/src/assistant/store/persistence.ts`
- `packages/runtime-state/src/{assistant-local-state-descriptors,assistant-runtime-issues,assistant-state}.ts`
- `packages/runtime-state/src/node/index.ts`
- `packages/assistant-runtime/src/{hosted-runtime,hosted-runtime-contracts}.ts`
- `packages/assistant-runtime/src/hosted-runtime/{execution,issues,platform}.ts`
- `apps/cloudflare/src/{runtime-platform.ts,runner-outbound/web-control.ts}`
- `apps/web/app/api/internal/hosted-execution/issues/record/route.ts`
- `apps/web/src/lib/hosted-execution/runtime-issues.ts`
- `apps/web/prisma/{schema.prisma,migrations/2026040600_init/migration.sql}`
- `packages/assistant-engine/src/assistant/{delivery-service,notification-turn}.ts`
- `packages/assistant-engine/test/{assistant-service-runtime,assistant-notification-turn-runtime}.test.ts`
- `apps/web/test/{hosted-execution-runtime-issues,hosted-onboarding-privacy-foundation-migration}.test.ts`

## Constraints

- Preserve unrelated dirty-tree edits everywhere else.
- Do not widen into other assistant-runtime, hosted-run, or onboarding/privacy follow-up work already active in this tree.
- Keep stored issue payloads structured and sanitized; do not introduce raw prompt/response/tool payload persistence.
- Treat this as a supplied patch landing first; only make follow-up edits needed to fit current repo state or policy.

## Risks and mitigations

1. Risk: The patch introduces persisted state that conflicts with the repo's storage-placement or privacy rules.
   Mitigation: Inspect every new persisted record shape, export seam, and Prisma model before applying; adjust only if the patch violates the documented boundary.

2. Risk: The patch applies cleanly but misses current-type or integration expectations in adjacent runtime packages.
   Mitigation: Review touched owner files after apply, then run the repo-required scoped/high-signal verification commands plus diff hygiene.

3. Risk: The hosted-web import route could accidentally create a member-linked or over-detailed issue sink.
   Mitigation: Verify the schema, parser, and insert path only store the intended allowlisted structured fields and retain the no-member relation.

## Tasks

1. Inspect the supplied patch against the current repo state and policy docs.
2. Register the work in the coordination ledger, apply the patch, and review the resulting diff.
3. Make the minimal compatibility/privacy follow-ups required by current repo state.
4. Reconcile the greenfield Prisma baseline by folding overlapping one-off migrations back into `2026040600_init`.
5. Run the required verification and completion workflow steps that are feasible in this environment.
6. Commit only the touched paths with the active plan closure and summarize residual unrelated blockers.

## Verification

- passed: `pnpm --dir packages/runtime-state typecheck`
- passed: `pnpm --dir packages/runtime-state test`
- passed: `pnpm --dir packages/assistant-engine typecheck`
- passed: `pnpm --dir packages/assistant-engine test -- --run test/assistant-service-runtime.test.ts test/assistant-notification-turn-runtime.test.ts test/assistant-product-small-seams.test.ts`
- passed: `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-issues.test.ts --config vitest.config.ts --no-coverage`
- passed: `pnpm --dir ../.. exec vitest run apps/web/test/hosted-execution-runtime-issues.test.ts --project hosted-web-execution --config apps/web/vitest.workspace.ts --no-coverage`
- passed: `pnpm --dir ../.. exec vitest run apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts --project hosted-web-onboarding-core --config apps/web/vitest.workspace.ts --no-coverage`
- passed: `git diff --check`
- blocked-unrelated: `pnpm --dir packages/assistant-runtime typecheck` currently fails in `src/hosted-runtime/{browser-vault,models}.ts` because `@murphai/query/browser` no longer exports `createBrowserVaultReplica` / `BrowserVaultReplica`
- blocked-unrelated: `bash scripts/workspace-verify.sh test:diff <scoped files>` fans into the same assistant-runtime browser-vault typecheck blocker before reaching later app verification steps
Completed: 2026-04-21
