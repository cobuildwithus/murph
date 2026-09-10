# Use canonical settings transport and billing projections

## Outcome and invariants

Email and Telegram settings use one HTTP path in production and tests. Full Prisma billing rows project their nullable fields explicitly. Preserve readiness retries, response validation, error codes, decryption, intentional schedule omissions and write-side patch semantics.

## Evidence and owners

Settings helpers branch on fetch identity; only their alternate implementations validate required response fields. The shared onboarding client owns HTTP and API-error parsing. Billing queries supply full rows while mocks omit nullable columns.

## Plan and proof

- Consolidate transport through the shared client and delete unused JSON helpers.
- Exercise real shared-client success, invalid responses, API errors and readiness retry with synthetic fetch responses.
- Replace projection undefined checks and give database fixtures complete nullable columns.
- Run focused settings/billing tests, Web typecheck, complexity review, CI and ReviewGPT.

## Product UX

Outcome: preserve successful connection and truthful retry/failure presentation.
Reaches: email verify/resync and Telegram linking/resync; full and sparse billing state.
Proof: existing rendered settings tests plus direct shared-client response scenarios and billing projection/decryption tests.

## State and rollout

No database schema, writes, retry schedule, endpoint or deployment protocol changes. Old and new clients consume the same responses. No new state or abstraction.

## Progress

Implementation complete. Focused settings and billing proof passed: 127 tests in three unchanged-result suites and 22 Telegram rendered tests after correcting full-response mocks. Web typecheck and complexity guard passed. Parent reviewed transport, projection, and fixture diffs. Exact-head CI and ReviewGPT remain pending.
