# Hosted Assistant Automation Default

## Goal

Remove the `HOSTED_EXECUTION_ENABLE_ASSISTANT_AUTOMATION` opt-out so the hosted Cloudflare runner always attempts assistant automation by default whenever the persisted hosted assistant profile is present and ready.

## Why

- The current hosted path has a split mental model: hosted assistant automation is the default product behavior, but an extra env flag still implies it is optional platform wiring.
- That flag also drives runner env stripping, which makes the hosted runtime surface harder to reason about and easier to misconfigure.
- The intended hosted behavior is "works out of the box" for assistant replies once the hosted assistant profile and channel credentials are configured.

## Scope

- `packages/hosted-execution/src/env.ts`
- `packages/assistant-runtime/src/hosted-runtime/{context.ts,maintenance.ts}`
- `apps/cloudflare/src/hosted-env-policy.ts`
- `apps/cloudflare/src/deploy-automation.ts` if it still forwards the removed flag
- `.github/workflows/deploy-cloudflare-hosted.yml` if the deploy env passthrough still exposes the removed flag
- Focused `apps/cloudflare` and `packages/assistant-runtime` tests covering runner env policy and hosted automation readiness
- `apps/cloudflare/{README.md,DEPLOY.md}` and `ARCHITECTURE.md`

## Constraints

- Preserve fail-closed behavior for missing or invalid hosted assistant config.
- Keep least-privilege filtering for worker-only secrets, but stop treating model/channel credentials as optional-only when they are part of hosted assistant operation.
- Preserve unrelated dirty-tree edits already present in the hosted Cloudflare lane.
- Run the required verification for this hosted-runtime change and capture direct proof from focused tests.

## Verification Plan

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Focused Cloudflare/assistant-runtime tests that prove the flag is gone and hosted automation remains gated only by real readiness

## Notes

- Treat this as a hosted runtime/deploy-surface simplification, not a behavior expansion beyond the existing default-hosted-assistant path.
- Update durable docs in the same change wherever they still describe the removed env toggle.
Status: completed
Updated: 2026-04-03
Completed: 2026-04-03
