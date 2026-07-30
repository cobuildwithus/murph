# Extend group speaker-name cache lifetimes

Status: completed
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Reuse validated group speaker names for 14 days and reuse only a true
  profile-and-shared-contact miss for six hours.

## Success criteria

- Both `profile-name` and `unverified-owner-contact` results are positive cache
  entries with a fixed 14-day TTL.
- Only Web's explicit proof that every applicable authorized name source was
  checked and absent for a requested handle creates a negative cache entry with
  a fixed six-hour TTL.
- Failure, ambiguity, suspension, authorization loss, timeout, and malformed
  responses remain operation-local and are not persisted.
- Focused runtime tests, affected typecheck, required reviews, exact-head CI,
  and merge-conflict proof pass.

## Scope

- In scope: the existing assistant-runtime file-cache TTLs, additive explicit
  Web name-miss evidence, deterministic cache tests, and live
  architecture/security/reliability/testing documentation.
- Out of scope: cache invalidation, new state owners, new Web queries,
  profile/contact authority changes, or participant-effect behavior.

## Constraints

- Technical constraints: preserve the existing bounded, route-scoped,
  snapshot-excluded private file and its fail-soft behavior.
- Product/process constraints: contact labels remain explicitly unverified
  presentation; longer-lived residue must never authorize identity or effects.

## Risks and mitigations

1. Risk: a renamed, revoked, or newly shared label may be stale.
   Mitigation: document the fixed 14-day positive and six-hour true-miss
   staleness window, keep the cache snapshot-excluded and route-scoped, and
   retain server-side effect-time authorization.

## Tasks

1. Prove the current Web result treats shared contact labels as named positive
   results and add explicit evidence for only those omissions where every
   applicable authorized source was checked.
2. Change the two fixed TTLs and strengthen focused boundary coverage.
3. Update live owner documents and the PR intent/evidence.
4. Run focused verification, required reviews, exact-head CI, and merge proof.

## Decisions

- Reuse the existing positive/negative cache kinds. Add one optional
  `nameMissSenderHandles` response field so old Web responses remain readable
  and cannot create durable negative entries. No new cache key, source enum,
  invalidation path, or state version is needed.
- Existing entries keep their stored absolute expiry. The new duration applies
  naturally to subsequent successful writes without migration machinery.

## Verification

- Commands to run: focused Assistant Runtime cache test and package typecheck;
  preliminary completion-specialists ReviewGPT; product-experience review;
  parent final review; final ReviewGPT correction round; exact-head PR CI.
- Expected outcomes: both name sources remain cached through 14 days minus one
  millisecond and refresh at 14 days; a true unnamed result remains cached
  through six hours minus one millisecond and refreshes at six hours.

## Progress

- Focused proof passed: 16 Assistant Runtime, 63 Hosted Execution, 117 Web, and
  3 Cloudflare tests plus Assistant Engine, Assistant Runtime, Hosted Execution,
  Web, and Cloudflare typechecks.
- Product-experience review found and then cleared two negative-cache gaps:
  inferred policy omissions and batch-context contact-label ambiguity now stay
  operation-local.
- The preliminary ReviewGPT specialist pass returned two coverage findings.
  Its test-only patch was inspected and applied: the reader now directly proves
  out-of-request misses cannot persist, and the real-model group-call test
  requires the exact confirmation message reference.
- The focused real-model group-call command is locally blocked because
  `OPENAI_API_KEY` is absent. The test parses and typechecks; exact-head CI or a
  configured real-model lane owns execution.
Completed: 2026-07-29
