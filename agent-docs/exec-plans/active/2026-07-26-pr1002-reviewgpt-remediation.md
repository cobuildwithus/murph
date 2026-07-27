# PR 1002 ReviewGPT remediation

Status: active
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Resolve every accepted final ReviewGPT finding on draft PR 1002 without
  weakening account deletion, billing suspension, ordinary device disconnect,
  or companion sign-in behavior.

## Success criteria

- Every Link, OAuth, and companion SDK provider-creation path stages its own
  durable marker before provider I/O and consumes only that marker.
- Generic member suspension never destructively deletes a possibly pre-existing
  provider user.
- Account deletion retains markers and fails retryably when owner cleanup is
  unavailable, ambiguous, or failed.
- The settings deletion dialog preserves entered context and offers one
  accessible, freshly authorized retry for the known in-progress response.
- Focused unit, real-PostgreSQL ordering, typecheck, lint, canonical diff, and
  acceptance verification are complete or have exact unrelated blockers.
- The exact pushed remediation head passes a ReviewGPT correction round.

## Scope

- In scope: hosted device-start lifecycle fencing, account-deletion cleanup,
  settings retry presentation, design catalog proof, focused tests, durable
  owner docs, and PR verification metadata.
- Out of scope: provider API redesign, new persisted tables, queues,
  reconcilers, ordinary disconnect changes, billing lifecycle changes, and PR
  merge.

## Constraints

- Technical constraints: provider I/O stays outside database transactions;
  `hosted_member` remains the single lifecycle lock; existing
  `device_oauth_session` rows remain the marker owner.
- Product/process constraints: preserve critical wearable flows, keep the PR
  draft and unmerged, preserve unrelated work, and rerun ReviewGPT only on the
  exact pushed remediation head.

## Risks and mitigations

1. Risk: an SDK path returns a token after account deletion wins.
   Mitigation: commit under the member fence before minting, then re-read exact
   active ownership before returning the token.
2. Risk: concurrent starts erase another request's deletion authority.
   Mitigation: each commit consumes or replaces only its exact marker; prove
   sibling retention against real PostgreSQL.
3. Risk: a definitive retry response strands the browser-vault session.
   Mitigation: publish the existing invalidation signal without document reload,
   keep confirmation state, and obtain fresh sensitive-action authorization on
   retry.

## Tasks

1. Remove generic destructive request cleanup and sibling-marker deletion.
2. Fence SDK ensure/commit/token return with the existing marker and member lock.
3. Fail closed when expired-marker owner cleanup is unavailable.
4. Add the in-place retry state and production-component design studies.
5. Add focused unit and real-PostgreSQL regression proof.
6. Update live owner docs, run completion verification, push, and run the exact
   ReviewGPT correction round.

## Decisions

- Reuse the current marker table and owner lock; no new lifecycle owner.
- A rejected request retains its marker. Only explicit account deletion may use
  deterministic owner-level destructive cleanup.
- The known retryable deletion response stays in the existing dialog; ambiguous
  outcomes retain the existing reload/revalidation behavior.

## Verification

- `pnpm --dir packages/device-syncd test`
- `pnpm --dir packages/device-syncd typecheck`
- `pnpm --dir apps/web typecheck`
- Focused hosted-web Vitest suites for store, deletion service, settings, and
  design behavior
- Opt-in real-PostgreSQL device-start/account-deletion concurrency suite
- Affected hosted-web lint and frontend design proof
- `pnpm test:diff ...`
- `pnpm verify:acceptance`
- Exact-head ReviewGPT correction round and GitHub CI inspection
