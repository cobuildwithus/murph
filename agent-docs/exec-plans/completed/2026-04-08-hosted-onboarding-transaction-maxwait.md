# Hosted Onboarding Transaction Max Wait

## Goal

Raise the hosted onboarding interactive transaction acquisition budget so low-traffic remote database startup latency does not fail user-triggered onboarding routes with Prisma `P2028` while still keeping a bounded transaction policy.

## Why this work exists

- Hosted onboarding `send-code` is failing with Prisma `P2028` and the message `Transaction API error: Unable to start a transaction in the given time.`
- The hosted onboarding transaction wrapper currently relies on Prisma's default interactive transaction `maxWait`, which is too aggressive for this deployment.
- The sibling `../interface` web app already uses a 5 second transaction acquisition budget.

## Planned change

1. Apply an explicit hosted onboarding transaction `maxWait` that matches the sibling web default.
2. Add a focused test for the wrapper so the option stays intentional.
3. Run targeted and required verification, then commit only the touched files and plan artifact.

## Verification target

- `pnpm --dir apps/web test -- --run apps/web/test/hosted-onboarding-shared.test.ts`
- `pnpm typecheck`
- `pnpm --dir apps/web lint`
- `pnpm test:coverage` (note unrelated blockers if unchanged)
Status: completed
Updated: 2026-04-08
Completed: 2026-04-08
