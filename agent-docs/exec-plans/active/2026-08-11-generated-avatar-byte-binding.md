# Generated avatar exact-byte binding

Status: active — round 14 finding reproduced; correction and round 15 pending
Created: 2026-08-11
Updated: 2026-08-11

## Goal

Close the final generated-avatar delivery gap without adding a persistence or
authority owner: the exact bytes loaded for a direct or generated-reference
avatar effect must match accepted physical delivery evidence before those same
bytes reach the private publisher or image provider.

## Context

- PR #1533 remains draft.
- The owning ReviewGPT 0.5.124 round 14 checked `99ff781624e8`, verified
  requested `gpt-5.6-sol` and response `gpt-5-6-pro`, and returned one accepted
  finding with response SHA-256
  `e9123cc61d07359d886ceab00e4f9295e7612f539c3fb31f70e82f0ec69e5e5c`.
- A concurrent lane returned PASS on the same reviewed head, then merged current
  `main` and archived the prior plan. Its base reconciliation is retained, but
  its result does not override the independently reproduced byte-identity gap.
- The repeated-mechanism retrospective is recorded in the PR. The correction
  stays in the existing resolver, outbox verifier, provider, and publisher
  owners.

## Invariants

- Provider continuity, transcript provenance, capture lookup, and ref identity
  do not prove that the current bytes were visible.
- Generated source reuse requires exact ref, SHA-256, media type, byte length,
  same-session accepted outbox delivery, and later explicit foreground action.
- The consuming boundary must resolve once, verify that descriptor, and reuse
  the same byte snapshot for provider or publisher egress.
- Ordinary canonical captures absent from generated provenance preserve their
  existing path.
- A newly generated avatar output is authorized by its explicit generation
  action and is not treated as a reused source reference.

## Execution

1. Extend the existing hosted generated-delivery verifier input with current
   hash, media type, and byte length; compare them with the existing marker and
   outbox media identity.
2. Delete the ref-only pre-load loop. Verify direct source bytes after their one
   resolver read and publish that same snapshot.
3. Verify generated-avatar reference descriptors immediately after the existing
   resolver read and before the existing image-provider request.
4. Add production-shaped regressions for same-ref byte replacement on both
   routes, unchanged generated media, and ordinary capture preservation.
5. Run focused suites, typecheck, runner policy/assembly proof, exact-head CI,
   and fresh ReviewGPT round 15. Reconcile later base-only movement without
   rerunning a zero-finding review, then merge and retire the worktree.

## Required evidence

- Direct and generated-reference same-ref replacement tests fail before the
  publisher, image provider, and group mutation.
- Existing outbox, response-media, group-tool, and generated-image suites pass.
- Assistant Engine typecheck and Cloudflare runner-policy checks pass.
- Exact full runner assembly remains within the reviewed budget.
- Latest ReviewGPT version matches the registry; round 15 verifies exact head,
  concrete model, `ROUND_OUTCOME: PASS`, and `REVIEW_COMPLETE`.
- Required exact-head GitHub Actions are green and mergeability is clean.

## Current evidence

- The ref-only pre-load loop is deleted. Direct publication now verifies the
  descriptor returned by its one resolver read and publishes that same byte
  snapshot. Generated references run the same descriptor check immediately
  after their existing resolver read and before provider egress.
- The production-shaped direct and generated-reference regressions use the
  actual PNG fixture hash, succeed with unchanged bytes, replace the same ref
  with a valid WebP, and then fail before publisher/provider/group mutation.
  The ordinary-capture case remains green.
- Focused proof passes 2 tests. The complete affected set passes 303 tests
  across group-tool, outbox, service, response-media, and both image-generation
  suites. Assistant Engine typecheck passes.
- Runner CLI/entry bundle policy passes 50 tests and deploy-preflight coverage
  passes 85 tests. Fresh full assembly passes with an 8,717,638-byte Vault CLI,
  1,619,381-byte runner entry, 7,779,215-byte static closure, and 9,709,205-byte
  total against the retained 9,711,424-byte ceiling.
- `git diff --check` and the scoped identifier scan pass. Commit, push, PR-body
  refresh, exact-head CI, and round 15 remain.
