# Mailbox fetch phase timings and startup imports

Status: completed
Created: 2026-09-21
Updated: 2026-09-21

## Outcome and invariants

Expose callback authentication, connection acquisition, owner-lock/read, mailbox,
usage, transaction completion, and optional crypto costs without logging private
content or adding database/network calls. Remove unused Google SDK loading from
envelope-only reads while preserving auth, replay, fence, consent and usage policy.

## Evidence and owners

The fetch route has no phase diagnostics. Its crypto dependency reaches eager
Google KMS/auth imports, including a top-level auth subclass. Envelope reads use
signature verification without a KMS RPC but construct crypto configuration.
The existing Prisma collector and pool-connect wrapper own database timings;
the existing KMS transport owns SDK initialization, deadlines and retries.

## Work (completed)

1. Measure fresh-process SDK import cost with synthetic local probes.
2. Defer SDK loading inside the existing operation deadline and client lifetime.
3. Add bounded request-local phase and database timing output, including failure.
4. Prove envelope-only loading, actual SDK operations, auth/usage/fence behavior,
   concurrency isolation, and diagnostic failure isolation; run Web typecheck.
5. Review and commit the scoped change with documentation and measurement limits.

## Risks and deployment

No persisted state, migration, wire requirement or new retry/cache owner. SDK
initialization must stay inside the existing cancellation/deadline boundary and
share one client. Log only finite phase names, timings, counts and verified signed
timestamps. Local imports do not establish Vercel production latency savings.
Web-only rollout; existing Worker consumers remain compatible. Deployment and
production measurements are separate from this local implementation.

## Verification

Passed focused route, Prisma, crypto and dependency tests, Web typecheck and
source ESLint. The initial five-suite regression run passed 261 tests; added
proof covers concurrency, callback/promise failure propagation, secret-safe logs,
logging failure isolation and real PostgreSQL pool attribution. Separate local
PostgreSQL callback/nonce/pool-identity proof passed nine tests. The final affected
collector/callback suites passed 106 tests; the queued-pool diagnostic regression
passed after correcting lazy thenable scope. `pnpm complexity:diff`,
`pnpm docs:drift` and `git diff --check` passed. Existing above-threshold hotspots
in KMS retry classification and Prisma error classification are unchanged.
Parent review found no change to database query count, authorization, encrypted
response shape, retries, deadlines, key zeroization or SDK cancellation semantics. Final external review remains required before PR
completion for sensitive hosted code; no PR or production mutation requested.

## Local measurements

Fresh Node 24 processes loaded an esbuild CJS bundle of the KMS owner in median
98 ms before and 2 ms after (seven samples each); evaluated CommonJS cache entries
fell from 308 to 1. A fuller mailbox-route probe used the same Web tsconfig,
server condition and external Prisma/Google/Vercel/pg/Next dependencies on both
sides, alternating ten fresh-process samples per candidate. Its median import
fell from 233 ms to 152 ms; evaluated external module entries fell from 418 to
111. Source module graph and SDK behavior tests provide deterministic regression
proof; these synthetic local bundles are not the Vercel production artifact.

## Product UX and changelog

Outcome: reduce unnecessary callback startup work and make remaining delay
attributable. Reaches: personal/group mailbox fetch, denied access, stale authority,
usage denial, and optional envelope/presentation reads. Proof: existing composed
route/crypto coverage and isolated PostgreSQL callbacks. Ready for local scope;
production benefit requires deployment and observation. No assistant semantics,
provider input, response contract, permissions or delivery behavior changes.
Changelog not applicable: internal diagnostics and dependency-loading change;
no production latency improvement is claimed as a shipped member outcome.

## Additional diagnostic finding

Real PostgreSQL proof exposed lazy Prisma thenables escaping the existing timing
collector when a callback returned a query directly. Awaiting that callback
inside AsyncLocalStorage fixes attribution without changing SQL or retry behavior.
The real pool test now distinguishes an empty initial pool from a deliberately
queued checkout. No new provider/database calls are introduced on the reply path.

## Handoff

Local implementation and verification complete. The final composed PostgreSQL
request also proves stale authority remains 409 while its diagnostic preserves
`failedPhase: authority` through transaction rollback. No production configuration
or data was changed. A future PR needs the routed final ReviewGPT and exact-head
CI gates; deployment needs subsequent phase-log observation before claiming a
production improvement. The isolated test database is task-owned and disposable.
Completed: 2026-09-21
