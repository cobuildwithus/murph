# Batch runtime crypto context envelope reads

Status: completed
Created: 2026-10-24
Updated: 2026-10-24

## Goal

- Remove one serial database round trip from a runtime crypto-context cache miss.
  This is a source-proven simplification, not an attribution of a specific typing
  alert or a claim that its end-to-end delay is resolved.

## Success criteria

- Fetch the two required active envelopes in one bounded database snapshot.
- Preserve exact member/domain/root/signature checks, missing-root failure,
  context version, response schema, cache duration and callback authorization.
- Focused crypto/route tests, Web typecheck, native review and exact-head CI pass.

## Scope

- In scope: existing Web crypto owner and synthetic regression proof.
- Out of scope: typing placement/origin/thresholds, cache lifetimes, key or access
  changes, runtime behavior, billing, standby fixes, production traffic generation.

## Constraints

- Reuse `readActiveHostedDomainRootRows`; the active user/domain unique index
  bounds this read to two rows. Verify both signed envelopes with the existing
  owner, sequentially, and preserve ingress-first error behavior.
- No Claude or new external model service invocation. Preserve the required
  independent-review boundary if the prohibition leaves it unavailable.
- Existing #4336 remains complete. Active mailbox acknowledgement and Temporal
  owners have different file scopes; no release reservation is claimed.

## Risks and mitigations

1. Batched row selection could mix domains or overlook revoked/missing roots.
   Keep canonical verification and test missing, inactive, foreign and malformed
   envelopes as well as successful exact output and call count.
2. Performance overclaim: a saved DB call does not prove total typing improvement.
   Report deterministic call reduction separately from natural-traffic results.
3. Deployment skew: existing clients must receive the identical response contract.
   No schema, protocol, cache or runner changes; Web-only release is compatible.

## Tasks

1. Reproduce two queries on the existing signed-envelope fixture.
2. Batch the reads through the existing helper; retain verification order.
3. Prove success/failure and endpoint authorization, typecheck and review.
4. Prepare scoped PR and exact-head CI, coordinate applicable review/release gates.

## Decisions

- No new abstraction or cache. No KMS unwrap, signing or provisioning on this read.
- Internal performance correction; no user-facing feature or promise change.
- Changelog not applicable: internal query batching preserves responses, errors,
  authorization and cache behavior. No measured member-visible speedup is claimed.
- Native candidate review: the existing partial unique index ensures one active
  row per member/domain, so batching does not change newest-row selection. Both
  envelopes still pass the same signature and identity checks. No new runtime
  schema, KMS operation, key lifetime, retry, timeout or cache is introduced.
- Product UX patch: outcome is less startup database work; reaches existing
  authenticated crypto-context consumers on cache misses. Signed success,
  inactive roots, other members, invalid signatures and endpoint denial preserve
  the existing result. Ready for this narrow claim; overall typing latency remains
  unproven and is not the claim of this patch.

## Verification

- Baseline `pnpm --dir apps/web test:prepared test/hosted-crypto-domain-root-store.test.ts -t 'web runtime crypto context'`:
  one failure (expected one raw query, observed two), one pass.
- Candidate full focused crypto file: 75 tests pass. Endpoint file: three tests
  pass (authorized success, missing workspace, unauthenticated callback).
- `pnpm --dir apps/web typecheck`: pass.
- `pnpm complexity:diff`: pass, debt 0, max 19, no functions above 20.
- `git diff --check`: pass. No lockfile or generated tracked-file changes.
- Native review found no remaining issue in the bounded query substitution.
- Pending completion gates are tracked on the PR: exact-head CI and the required
  independent review. New external model services are currently prohibited, so
  ReviewGPT has not been invoked; merge/deploy remain held at that boundary.
Completed: 2026-10-24
