# Remove remote provider authorization

Status: active
Created: 2026-09-30
Updated: 2026-09-30

## Outcome and current evidence

Remove the awaited Web/Postgres provider authorization round trip without moving
typing earlier. The current callback authenticates three overlapping bearer
schemes, although Cloudflare already supplies the physical container identity.
The native controller already owns member binding, invocation lifetime, and
usage settlement. Reuse that boundary and delete redundant credential issuance
and validation. Preserve provider secrets outside the container, operation
allowlists, member isolation, custom inference, and metering.

## Architecture and deletion

- Resolve the physical controller only from Cloudflare container ID and class.
- Extend its existing invocation receipt with admitted provider context. Keep
  Postgres as the admission, canonical mutation, and usage-ledger owner.
- Read provider context and settlement state together at the native controller;
  no remote Web authorization in the ordinary provider path and no positive cache.
- Remove signed provider credentials and invocation provider-token production.
  Keep existing Web protocol readers for already deployed Workers until rollout
  converges; the new Worker sends no provider-authorization commands.
- An invocation registered before this deployment may populate missing native
  context once from its exact existing Web owner. Remove that bounded migration
  path after predeployment invocations have completed or retired.
- Retirement revokes provider access at the existing native lifecycle boundary;
  already admitted effects may finish. Do not add revocation fanout or timers.

## Product UX

Effort: Patch.
Outcome: Less awaited authorization work before typing and provider requests.
Reaches: Messaging, managed providers, custom inference, live voice, warm reuse.
Proof: Composed provider interception, native persistence/restart, mismatched
caller identity, completion/retirement, denied/uncertain usage, rollout skew.

## Work and verification

1. Native receipt context and platform-bound provider authorization.
2. Delete redundant credentials and callback dependency; preserve accounting.
3. Update focused fixtures, tests, durable owner docs, and changelog.
4. Focused tests, relevant typechecks, complexity, and parent review.
5. Update PR #3929, obtain final ReviewGPT and exact-head CI green.

## Deployment

Worker/controller changes deploy together. Old warm container images may still
send ignored legacy provider headers/credentials; physical identity is authority.
Web retains old readers and schema for independent rollout. No production
mutation, Postgres schema migration, new service, configuration, or dependency is needed.
The existing native SQLite receipt gains one nullable provider-context column.

## Candidate evidence

Native invocation context survives eviction; exact legacy backfill persists once.
Completed/retired/missing platform callers deny provider access. Forged request
headers cannot select the member. Typing makes zero Web authorization calls.
Pending/denied usage latches survive controller restart. Existing Live resources
remain closable during retirement, while creation is denied. Native Codex HTTP
and WebSocket passthrough, real ContainerProxy dispatch, custom inference, and
Linq/Telegram client delivery retain focused regression coverage.

Parent review: recipient routing remains with the runtime journal; provider
authority now authenticates the admitted container as a whole. Postgres-only
revocation requires the existing native retirement path to stop provider access.
No claim of atomic cancellation of already admitted external effects.

Old Web protocol readers, nullable token-hash schema, and the old settlement RPC
remain only for deployed Workers. The existing encryption/signing key stays for
BYO inference envelopes and Live resource references. Rolling back to a Worker
that requires bearer credentials needs new invocations to drain or retire first.

Production end-to-end timing remains unmeasured for this candidate; removing the
callback does not prove every alert falls below three seconds.

## Review remediation

Round 3 on the merged candidate identified a real billing gap: usage admission
read Web before creating the native pending marker, so failure at that first
read let subsequent direct-metered calls continue. Accepted. Resolve settlement
through the existing authenticated physical caller, create the existing native
receipt first, and let the signed usage callback own canonical authorization.
Delete the extra Web admission read; add no state, retries, or durable owner.

Composed transcription proof makes all Web endpoints unavailable: the first
transcript still returns, pending evidence survives receipt reconstruction, and
the next billable call is blocked. Explicit-success clearing and mismatched
identity rejection also pass. All 597 affected provider, internal callback,
hosted-local wrapper, and settlement tests pass. The separate CI alert fixture
now asserts only the remaining image-access call; all 17 workerd tests pass.
