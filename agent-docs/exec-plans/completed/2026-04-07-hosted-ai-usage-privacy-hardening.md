# Hard-cut hosted AI usage debug persistence and align hosted auth docs

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Remove hosted AI usage debug persistence entirely so hosted usage rows keep only billing-safe counters and routing metadata, and align the shared hosted-execution package/docs with the current app-local hosted auth model.

## Success criteria

- `HostedAiUsage` no longer persists provider/session/request ids or raw provider/usage JSON.
- The hosted AI usage importer no longer reads `HOSTED_AI_USAGE_PERSIST_DEBUG_FIELDS`.
- The current greenfield Prisma schema/migration no longer includes the removed debug columns.
- Hosted env/docs no longer advertise the removed debug flag or stale shared HMAC secret guidance.
- `@murphai/hosted-execution` no longer exports the legacy shared HMAC sign/verify helpers, while app-local callback signing/verification still uses the shared canonicalization helpers.

## Scope

- In scope:
- `apps/web` hosted AI usage persistence, schema, env example, README, and focused tests.
- `packages/hosted-execution` exports/docs for shared auth helpers.
- Focused Cloudflare auth test cleanup if it only covered the removed shared HMAC surface.
- Out of scope:
- Broader hosted billing/webhook/outbox privacy reductions called out in the supplied notes.
- Any additional Cloudflare/web app auth redesign beyond removing stale shared HMAC helpers and stale docs/env references.

## Constraints

- Technical constraints:
- Preserve current app-local Cloudflare callback signing/verification, which still depends on the shared request canonicalization helpers.
- Treat the supplied patch as intent only and port it onto the current tree shape.
- Product/process constraints:
- Preserve unrelated dirty worktree edits and overlapping hosted lanes.
- Run the required repo verification for touched `apps/web` and package surfaces plus a completion audit pass.

## Risks and mitigations

1. Risk: Prisma schema/migration edits drift from the live greenfield baseline.
   Mitigation: Update both `schema.prisma` and the checked-in init migration together, then re-read the resulting DDL.

2. Risk: Removing shared auth exports breaks live callers that still depend on canonicalization helpers.
   Mitigation: Remove only the unused shared HMAC sign/verify surface and keep the shared request canonicalization/header-reading helpers used by app-local callback adapters.

## Tasks

1. Remove hosted AI usage debug-field persistence from the importer, tests, schema, and greenfield migration.
2. Remove stale hosted AI usage debug env/docs and stale shared-secret examples from hosted env/docs.
3. Remove the legacy shared HMAC helper exports from `@murphai/hosted-execution` and update README/tests to match the app-local auth model.
4. Run required verification, complete the audit pass, and land a scoped commit.

## Decisions

- Because the hosted schema is still greenfield/reset-only, remove the hosted AI usage debug columns from the committed initial Prisma migration instead of adding a forward cleanup migration.
- Remove only the shared HMAC sign/verify helpers now; keep the shared request canonicalization helpers because current app-local callback auth still imports them.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:coverage`
- Focused readback of touched Prisma schema/migration and hosted docs/env files
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --project hosted-web-execution apps/web/test/hosted-execution-usage.test.ts --no-coverage`
- `pnpm --dir packages/hosted-execution typecheck`
- `pnpm --dir packages/hosted-execution test`
- `pnpm --dir apps/web lint`
- `git diff --check -- <touched paths>`
- Expected outcomes:
- Repo acceptance commands pass, or any failure is proven unrelated before handoff.
- Touched hosted AI usage paths and package exports/docs read back cleanly with no remaining debug-persistence flag or removed shared HMAC helper references in the implemented scope.

## Outcome

- Implemented as a hard cut: hosted AI usage importer/schema/init migration no longer persist the four debug fields, and the shared hosted-execution package no longer exports the legacy HMAC sign/verify helpers.
- Scoped proof passed for the touched surfaces:
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts --project hosted-web-execution apps/web/test/hosted-execution-usage.test.ts --no-coverage`
  - `pnpm --dir packages/hosted-execution typecheck`
  - `pnpm --dir packages/hosted-execution test`
  - `pnpm --dir apps/web lint` (warnings only, no errors; warnings were pre-existing and outside this task)
  - `git diff --check -- <touched paths>`
- Repo-wide acceptance remains blocked by unrelated pre-existing workspace failures:
  - `pnpm typecheck` fails in `packages/core/src/vault.ts` plus unrelated assistant/device-sync/workout areas already dirty in the worktree.
  - `pnpm test:coverage` fails in the same broader pre-existing workspace/type surface.
  - `pnpm --dir apps/web typecheck` also reaches the same unrelated `packages/core/src/vault.ts` failure because `apps/web` compiles against workspace source.
Completed: 2026-04-07
