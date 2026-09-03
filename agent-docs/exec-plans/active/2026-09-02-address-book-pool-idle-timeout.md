# Shorten Vercel database pool idle tail

Status: active
Created: 2026-09-02
Updated: 2026-09-02

## Goal

- Keep hosted companion address-book status reads from exhausting their Vercel
  invocation budget after normal database work completes, while preserving the
  shared PostgreSQL pool and its connection-retirement contract.

## Success criteria

- The hosted Web PostgreSQL pool retires idle clients after five seconds, which
  bounds the `attachDatabasePool` request-lifetime tail to approximately 5.1
  seconds instead of approximately 30.1 seconds.
- The same module-scoped pool remains attached to Vercel and reusable by active
  or concurrent requests.
- Focused pool and companion address-book route tests pass, and the Web
  TypeScript check passes.
- The member-visible reliability improvement is represented in the current
  changelog and the exact pushed PR head passes required CI and ReviewGPT.

## Scope

- In scope: hosted Web PostgreSQL idle retirement, focused pool assertions,
  existing pool-lifecycle documentation, and the public reliability note.
- Out of scope: authentication, address-book query behavior, pool-size policy,
  database connection acquisition timeout, dependencies, schemas, and provider
  ingestion behavior.

## Product UX patch

- Outcome: Connected members' routine companion status checks keep the same
  result while avoiding an unnecessarily long idle cleanup tail.
- Reaches: The existing authenticated companion address-book status journey;
  no screen, action, audience, permission, or data meaning changes.
- Proof: Existing composed-auth and route tests preserve successful and denied
  responses, while the production-pool test proves the shorter attached-pool
  idle boundary.

Walkthrough: a connected member receives the same status JSON, an unauthorized
request receives the same error, and other hosted Web requests retain the same
shared-pool behavior while fully idle clients retire sooner. The focused route
and pool tests cover those boundaries. No presentation state changes, so
rendered evidence adds no proof. Result: Ready.

## Constraints

- Technical constraints: retain one globally reusable `pg` pool and
  `attachDatabasePool`; do not replace the proven lifecycle mechanism with
  route-local retries or a longer function timeout.
- Product/process constraints: keep production evidence private, preserve all
  existing authorization behavior, and ship through the isolated PR lane with
  focused local proof plus exact-head gates.

## Risks and mitigations

1. Risk: A request arriving after more than five seconds of complete pool
   inactivity may need to establish a new database connection.
   Mitigation: Active traffic still reuses the shared pool, the five-second
   value follows Vercel's current Fluid Compute guidance, and existing bounded
   connection acquisition and failure diagnostics remain unchanged.

## Tasks

1. [x] Apply and inspect the ReviewGPT patch against current `origin/main`.
2. [x] Add the required member-facing changelog fragment with public-safe claims.
3. [x] Run focused pool and address-book tests, Web typecheck, changelog proof,
   and complexity/diff checks.
4. [ ] Commit, push, open the draft PR, and complete exact-head CI and final
   ReviewGPT before merge.

## Decisions

- Preserve `attachDatabasePool` rather than deleting the connection-suspension
  protection.
- Keep the route's 60-second deadline as the failure boundary; reduce the
  avoidable idle tail instead of masking it with more runtime.
- Reuse the existing production-pool test instead of adding a duplicate test
  for the same idle-timeout and attachment assertions.

## Verification

- Passed: `pnpm --dir apps/web test -- prisma-store-client.test.ts
  device-sync-companion-address-book-route.test.ts
  device-sync-companion-address-book-route-composed-auth.test.ts` (3 files, 70
  tests); `pnpm --dir apps/web test -- changelog-page.test.tsx` (1 file, 9
  tests); `pnpm --dir apps/web typecheck`; `pnpm complexity:diff`; and `git diff
  --check`.
- Pending: exact-head GitHub Actions, final ReviewGPT, parent final review, and
  current-base merge-tree proof.
