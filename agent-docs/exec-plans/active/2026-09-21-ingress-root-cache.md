# Reuse prepared ingress keys across requests

Status: active
Created: 2026-09-21
Updated: 2026-09-21

## Goal

Reduce repeated ingress KMS unwraps on the Web message admission path, building
on the existing unchanged-Linq-route optimization. Deliver a combined PR with
focused proof, green required checks and a resolved final ReviewGPT review.

## Scope and constraints

- Ask ReviewGPT Pro to implement a patch against the current committed snapshot.
- Prefer bounded process-local ingress key reuse at the existing crypto owner.
- Keep durable payload encryption, fresh root metadata, locked authority,
  request-scoped buffer ownership, rotation and revocation behavior.
- Explicitly bound key lifetime and memory; cache no failures or access decisions.
- No production mutations, deployments, merges, schema changes or new services.
- Keep all evidence synthetic and all private identifiers out of artifacts.

## Tasks

1. Delegate an attachment-based implementation to ReviewGPT with exact source context.
2. Inspect and apply the patch; independently trace lifetime, authority and concurrency.
3. Run focused composed tests, Web typecheck and complexity checks; update owners
   and a public-safe performance changelog entry.
4. Commit, push and open a draft PR, complete candidate review, then start final
   ReviewGPT immediately on the stable ready head concurrently with CI.
5. Resolve findings within task authority, verify exact-head checks and current-base
   mergeability, and hand off the PR without merging or deploying.

## Product UX

- Outcome: less repeated preparation before an established conversation can start.
- Reaches: Web requests that encounter a recently unwrapped identical ingress root
  in the same process; cold instances and expired entries still unwrap normally.
- Proof: two independent request scopes, one KMS call, valid encrypted payloads,
  preserved authority and bounded fallback. No sub-three-second guarantee.

## Verification

- Focused root-store/cache/preparation and Linq dispatch tests.
- Web typecheck, complexity guard, full diff/privacy review and changelog rendering.
- Final exact-head ReviewGPT alongside required CI; current-base mergeability.

## Decisions and evidence

- The cache should eliminate repeated KMS work; the existing authoritative DB
  reads remain unless the implementation proves a safe simpler arrangement.
- Waiting and response capture remain owned by this session via --wait.

## Implementation and local review

- Pro returned an apply-ready patch against the existing route optimization.
  Its exact captured response used the requested Pro model. The patch applied
  cleanly and the parent reviewed its complete production and test diff.
- Process-local ingress retention is fixed at 30 seconds and 128 FIFO entries
  (4 KiB of root bytes). Hits do not refresh expiry. Independent copies and
  timer/deadline eviction preserve ownership; erasure is best effort in JavaScript.
- Current envelope/signature/wrap checks precede lookup. The complete envelope
  and loaded crypto configuration identify entries, with the same KMS-client
  owner required. Fresh metadata and locked preparation remain authoritative.
- Concurrent cold requests may unwrap independently. There is no shared pending
  promise, cancellation, failure cache, queue or new retry owner.
- KMS-only policy revocation can take up to the remaining cache lifetime to
  affect reuse; database root revocation still prevents admission. The security
  owner documents process recycling as part of urgent key-response handling.
- Focused local proof: 373 tests passed across ingress caching, root store,
  prepared secure boxes, root authority, Linq binding/prewarm and dispatch.
  Web typecheck and complexity guard passed. No source complexity debt increased.
- Pro's isolated checks were not substituted for local pinned Vitest/typecheck.
- Tooling friction matched existing ReviewGPT exact-capture/download entries.
  The download recovery waited for the original exact capture identity using
  the installed exporter's identity-wait implementation, without altering capture
  metadata or skipping response/artifact validation. No shared tool files changed.
- Parent verdict: Ready for PR review. No live latency or deployment claim.
