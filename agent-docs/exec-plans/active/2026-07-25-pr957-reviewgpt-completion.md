# PR 957 ReviewGPT Completion

## Goal

Take PR 957 through the repository's exact-head preliminary specialist review,
parent final review, final ReviewGPT gate, and required CI checks, resolving
every accepted finding and PR-specific failure.

## Constraints

- Keep the product change limited to visible recovery outcomes for the existing
  Linq, Telegram, Privy, Family, routing, and billing states.
- Preserve privacy boundaries: account-specific explanations stay in direct
  messages, while group replies remain generic.
- Preserve provider thread targeting and source-event idempotency.
- Do not compose the overlapping PR 954 route imports until that PR lands.
- Do not add persisted onboarding state, orchestration, schema, or billing enums.

## Working Set

- Existing PR 957 source and tests under `apps/web`
- `apps/web/test/hosted-telegram-client.test.ts`
- PR description and exact-head ReviewGPT audit packages

## Verification Plan

- Focused Vitest for the Telegram transport assertion.
- Truthful `pnpm test:diff` coverage for the changed hosted onboarding routes,
  policy helpers, transport, and tests.
- Preliminary `completion-specialists` ReviewGPT pass on an exact pushed head.
- Parent final review, then final `pr-review` rounds until `ROUND_OUTCOME: PASS`
  with zero accepted findings.
- Required GitHub checks green on the final reviewed head, with unrelated flakes
  retried only after log evidence distinguishes them from PR-specific failures.
