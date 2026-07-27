# PR 1002 ReviewGPT remediation

Status: completed
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

- `pnpm --dir packages/device-syncd test`: 44 files and 871 tests passed.
- Device-syncd and hosted-web typechecks passed.
- Focused hosted store, deletion-service, and settings suites passed 92 tests.
- The opt-in real-PostgreSQL ordering suite passed seven tests, including
  sibling-marker retention, SDK atomic commit, and the cross-owner unique race.
- Affected hosted-web lint passed with zero errors.
- Desktop and mobile `/design?tab=sections` captures render the production retry
  component at 1440px and 390px; both public proof URLs returned `image/png`.
- The Claude Code UI double-check stopped at explicit Fable credit exhaustion,
  which is the documented non-blocking review gap.
- Crabbox `test:diff` Testbox `tbx_01kygjpd0jcv31h79m3zee6410` passed the
  affected package/app typechecks, then stopped outside this patch in
  `packages/vault-usecases` because a generated Health Commons Web artifact was
  absent in that lane.
- Crabbox `verify:acceptance` passed in Testbox
  `tbx_01kygjpd0n86qngdgtn0e93yag`.
- The exact-head ReviewGPT correction round and GitHub CI inspection follow the
  final plan-closing push.
Completed: 2026-07-26
