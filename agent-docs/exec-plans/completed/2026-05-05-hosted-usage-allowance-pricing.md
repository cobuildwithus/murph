# Restore hosted usage allowance pricing

Status: completed
Created: 2026-05-05
Updated: 2026-05-05

## Goal

- Ensure hosted usage callbacks keep importing Murph-owned `HostedAiUsage` rows and run Murph allowance accounting for direct OpenAI models, including `gpt-5.5`.

## Success criteria

- The hosted usage callback route calls `importHostedAiUsageRecords` with allowance accounting enabled.
- Direct OpenAI `gpt-5.5`, provider-prefixed `openai/gpt-5.5`, and dated `gpt-5.5-*` model ids remain covered by the Murph pricing table/model normalizer tests.
- No Vercel AI Gateway legacy meter-source compatibility is reintroduced.

## Scope

- In scope:
  - `apps/web/app/api/internal/hosted-execution/usage/record/route.ts`
  - Hosted usage route and allowance pricing tests.
- Out of scope:
  - Vercel AI Gateway usage accounting or delegated meter compatibility.
  - New model pricing beyond the existing Murph `gpt-5.5` table entry.

## Constraints

- Preserve unrelated dirty work in the current checkout.
- Do not print or persist secrets, raw provider payloads, or personal identifiers.
- Keep the callback trust boundary unchanged: only authenticated hosted Cloudflare callbacks can import usage.

## Tasks

1. Restore allowance accounting on the usage callback import path.
2. Update the route-level regression assertion.
3. Run focused hosted web usage tests and typecheck.
4. Run completion checks and close the plan if a scoped commit is blocked.

## Decisions

- Treat earlier `gpt-5.5` allowance errors as likely stale because the current Murph pricing table and normalizer already cover direct OpenAI `gpt-5.5` variants.
- Re-enable Murph allowance accounting instead of adding Vercel legacy data support.

## Verification

- Passed:
  - `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-execution-usage-route.test.ts apps/web/test/hosted-execution-usage-allowance.test.ts apps/web/test/hosted-execution-usage.test.ts --no-coverage`
  - `pnpm exec vitest run --config vitest.config.ts packages/hosted-execution/test/hosted-runtime-control.test.ts --no-coverage`
  - `pnpm --filter @murphai/hosted-web typecheck:prepared`
  - `pnpm --filter @murphai/hosted-execution typecheck`
  - `pnpm --dir apps/web lint`
  - `git diff --check` for touched files
  - diff privacy scan for touched files
- Full `pnpm typecheck` remains blocked by an unrelated generated Cloudflare deploy bundle hard-cut guard in `apps/cloudflare/.deploy/worker-bundle.mjs`.
- Required reviews:
  - Security/privacy review: no findings.
  - Task-finish review: no code findings; plan verification was updated from pending.
Completed: 2026-05-05
