# Privacy-first hosted transient retention

Status: completed
Created: 2026-04-06
Updated: 2026-04-06

## Goal

- Aggressively shorten Cloudflare-hosted transient artifact retention for privacy-sensitive hosted execution artifacts while keeping the current hosted share flow correct.

## Success criteria

- Cloudflare transient lifecycle rules move journals, side-effects, dispatch payloads, and hosted raw email from multi-day retention to short hour-scale backstops.
- Hosted share packs move from day-scale lifecycle retention to hour-scale retention without breaking valid share links.
- Hosted share-link product TTL is reduced to match the shorter share-pack privacy posture.
- Stale lifecycle/documentation residue tied to removed hosted-email thread-route writes is cleaned up where safe.
- Tests and durable docs reflect the new retention behavior.

## Scope

- In scope:
  - `apps/cloudflare/r2-bundles-lifecycle.json`
  - `apps/cloudflare/**` docs/tests directly tied to lifecycle retention
  - `apps/web/src/lib/hosted-share/**`
  - `apps/web/test/hosted-share-service.test.ts`
  - Durable docs that describe the changed retention and share-link behavior
- Out of scope:
  - Replay tombstone retention or broader queue-idempotency policy
  - New storage classes or large hosted-share product redesign

## Constraints

- Treat transient object retention as a backstop, not the normal cleanup path.
- Keep hosted share behavior correct for valid unconsumed links after the TTL cut.
- Preserve unrelated dirty-tree edits and stay narrow because other hosted-runtime lanes are active.

## Risks and mitigations

1. Risk: Shortening share-pack TTL without shortening the share-link product TTL breaks valid links.
   Mitigation: Reduce the share-link default/max TTL in the same change and update tests/docs together.
2. Risk: Over-shortening transient journals or payloads could weaken crash recovery.
   Mitigation: Keep journal/side-effect/payload retention in the hour range rather than minutes-only while preserving best-effort eager deletion.
3. Risk: Lifecycle docs drift from code.
   Mitigation: Update the checked-in lifecycle config, Cloudflare docs, and durable architecture/readme text in the same patch.

## Tasks

1. Update the checked-in R2 lifecycle rules to a privacy-first retention profile and remove stale thread-route lifecycle handling if it is truly dead.
2. Shorten hosted share-link TTL behavior so share-pack retention can move from days to hours safely.
3. Update tests and durable docs for the new retention/TTL behavior.
4. Run required verification, perform a local final review, close the plan, and create a scoped commit.

## Decisions

- Use hour-scale backstops for recovery artifacts instead of minutes-only so crash recovery remains plausible.
- Make hosted share links short-lived by default and by cap so share-pack lifecycle can also be hour-scale.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Expected outcomes:
  - Required checks pass, or any unrelated pre-existing failures are identified precisely.
- Outcomes:
  - `pnpm exec vitest run apps/cloudflare/test/r2-lifecycle.test.ts --config apps/cloudflare/vitest.config.ts --coverage.enabled=false` passed.
  - `pnpm exec vitest run apps/web/test/hosted-share-service.test.ts --config apps/web/vitest.config.ts --coverage.enabled=false` passed.
  - `pnpm --dir apps/cloudflare typecheck` passed.
  - `pnpm --dir apps/web typecheck` passed.
  - `pnpm typecheck` failed on a pre-existing workspace-boundary violation in `packages/cli/test/assistant-state.test.ts` importing a non-public `@murphai/assistant-core` entrypoint.
  - `pnpm test` failed on the same pre-existing workspace-boundary violation before the touched hosted surfaces ran.
  - `pnpm test:coverage` failed in unrelated pre-existing CLI coverage lanes (`packages/cli/test/assistant-service.test.ts`) and then hit a coverage temp-file `ENOENT` under `coverage/.tmp/coverage-20.json`.
Completed: 2026-04-06
