# Hosted Architecture Cleanups Patch Landing

Status: completed
Created: 2026-04-06
Updated: 2026-04-06

## Goal

- Land the returned hosted-architecture cleanup patch where it still fits the current repository so Cloudflare owns canonical hosted device-sync runtime state, pending hosted usage import scales via dirty-user indexing, reference-backed outbox rows require staged payload refs, hosted member access derives from billing plus suspension, and Durable Object runtime bootstrap metadata uses the new `runtimeBootstrapped` seam with a legacy migration path.

## Success criteria

- The applicable patch intent is ported into the current tree with conflicts resolved against newer repo changes.
- Required verification passes for the touched hosted/runtime surfaces, or any unrelated red command is documented with a defensible separation.
- The landing is committed with a scoped dirty-tree-safe commit and this plan is closed.

## Scope

- In scope:
- Returned patch file at the supplied downloads path for hosted architecture cleanups
- Hosted-runtime code, contracts, Prisma schema/migrations, and durable docs directly touched by that patch intent
- Out of scope:
- Unrelated assistant-core capability-catalog lane already in progress
- New design work beyond what the patch materially requires

## Constraints

- Technical constraints:
- Preserve unrelated dirty worktree edits and resolve around newer repo changes instead of reverting them.
- Keep changes scoped to the returned patch intent; do not opportunistically expand adjacent hosted refactors.
- Product/process constraints:
- Follow repo completion workflow, required verification, required audit pass, and scoped commit rules.
- Treat the patch file as behavioral intent, not overwrite authority.

## Risks and mitigations

1. Risk: The patch spans multiple hosted storage contracts and could conflict with current Cloudflare/web runtime changes.
   Mitigation: Compare the patch against the current tree first, port only applicable hunks, and validate the contract edges with focused reads before editing.
2. Risk: Storage-ownership and schema changes can introduce runtime regressions or mismatched migrations.
   Mitigation: Run the full required verification baseline and add direct scenario proof for at least one affected hosted path if needed.

## Tasks

1. Inspect the patch and map its touched files against the current worktree.
2. Port the applicable hosted architecture changes into the current repository, resolving conflicts carefully.
3. Run required verification and address change-attributable failures.
4. Run the required final review pass, then close the plan and create the scoped commit.

## Decisions

- Use a plan-bearing workflow because the patch is cross-cutting, touches hosted trust/runtime seams, and includes schema/storage behavior changes.
- Keep the unrelated assistant-core capability-catalog lane out of scope unless the patch materially intersects with shared files that require a careful merge.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- Commands pass, or unrelated blockers are recorded with exact failing targets and why the landed diff did not cause them.
- Outcomes:
- `pnpm typecheck`: passed
- `pnpm test`: failed in unrelated dirty assistant-core/CLI lane (`packages/inboxd/test/idempotency-rebuild.test.ts`, `packages/cli/test/assistant-cli.test.ts`, `packages/cli/test/assistant-service.test.ts`, `packages/cli/test/incur-smoke.test.ts`)
- `pnpm test:coverage`: failed in unrelated dirty assistant-core/CLI lane (`packages/cli/test/assistant-service.test.ts`)
- Targeted hosted follow-up checks passed:
- `pnpm --dir ../.. exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-execution-outbox-payload.test.ts apps/web/test/hosted-execution-contract-parity.test.ts apps/web/test/hosted-execution-outbox.test.ts apps/web/test/hosted-onboarding-stripe-event-reconciliation.test.ts --no-coverage`
- `pnpm --dir ../.. exec vitest run apps/cloudflare/test/usage-store.test.ts --config apps/cloudflare/vitest.config.ts`
Completed: 2026-04-06
