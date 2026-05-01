# Protocol Outcome Signal Cleanup

## Goal

Remove protocol outcome-signal entries that are really intervention exposure, adherence, or dose-shape checks rather than downstream outcome signals.

## Scope

- Health Commons protocol content only.
- Remove the agreed signals from outcome slots while preserving them as possible logging/context concepts where the existing prose still needs them.
- Do not touch generated catalog artifacts unless verification requires regeneration.

## Files

- `packages/health-commons/content/protocols/added-sugar-reduction/no-added-sugar-diet.md`
- `packages/health-commons/content/protocols/consistent-wake-time/consistent-wake-time.md`
- `packages/health-commons/content/protocols/alcohol-abstinence/short-term-alcohol-abstinence.md`
- `packages/health-commons/content/protocols/daily-step-floor/daily-step-floor.md`
- `packages/health-commons/content/protocols/creatine-supplementation/creatine-monohydrate.md`
- `packages/health-commons/test/runtime.test.ts`
- `apps/web/test/health-commons-bryan-johnson-protocol.test.ts`

## Verification

- `pnpm --filter @murphai/health-commons generate:check`
- `pnpm exec vitest run --config packages/health-commons/vitest.config.ts packages/health-commons/test/runtime.test.ts --no-coverage`
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/health-commons-bryan-johnson-protocol.test.ts --no-coverage`
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff <touched files>` if the generated/content check succeeds and the dirty tree allows a truthful scoped lane.

## Outcomes

- Passed: `pnpm --filter @murphai/health-commons generate:check`
- Passed: `pnpm exec vitest run --config packages/health-commons/vitest.config.ts packages/health-commons/test/runtime.test.ts --no-coverage`
- Passed: `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/health-commons-bryan-johnson-protocol.test.ts -t "strips Health Commons source keys from public Daily Step Floor copy" --no-coverage`
- Passed: `pnpm typecheck`
- Blocked by unrelated dirty checkout state: full `apps/web/test/health-commons-bryan-johnson-protocol.test.ts` failed on a cold-plunge description mismatch; scoped `test:diff` and Health Commons package verify hit pre-existing generated-JS/catalog-hash failures.
Status: completed
Updated: 2026-05-02
Completed: 2026-05-02
