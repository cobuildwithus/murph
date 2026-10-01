# Meal-photo enrollment provider-free transaction

## Outcome

Move meal-photo enrollment secret open/seal work before database checkout while
preserving the existing member-lock authority boundary, credential semantics,
and response contract.

## Scope

- Keep the implementation inside the existing meal-photo capture owner.
- Reuse prepared domain-root and provider-disabled transaction primitives.
- Retry only one proven preparation mismatch with a fresh request-local cache.
- Add focused deterministic proof for new and existing enrollment preparation,
  drift, concurrency, request isolation, and unchanged enrollment behavior.
- Do not add schema, services, queues, dependencies, or compatibility layers.

## Verification

- `pnpm --dir apps/web test:prepared -- test/device-sync-companion-meal-photo-capture-enrollment-crypto-boundary.test.ts test/device-sync-companion-meal-photo-capture-enrollment.test.ts`
  passed 32 tests.
- `pnpm --dir apps/web typecheck:prepared` passed.
- Touched-file ESLint passed.
- `scripts/check-agent-docs-drift.sh` and diff hygiene checks passed.
- Exact-head preliminary and final ReviewGPT gates plus required PR CI remain PR
  follow-through work.
Status: completed
Updated: 2026-08-26
Completed: 2026-08-26
