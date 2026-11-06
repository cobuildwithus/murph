# Retain the original input in instant-reply delivery observation

Status: completed
Created: 2026-10-05
Updated: 2026-10-05

## Goal

Link an accepted Web instant reply to its original inbound trace using the
existing observation owner, without changing delivery or wake behavior.

## Success criteria

- Prove the lost original-input association through the actual composed path.
- ReviewGPT authors a small telemetry-only correction and regression proof.
- Preserve echo wake/checkpoint, provider effects, optional post-response trace
  writes, member ownership and existing write-once delivery guards.
- Pass focused verification, final review and exact-head CI; verify any authorized
  canonical telemetry deployment with read-only revision and natural evidence.

## Scope

- In scope: in-memory telemetry context, existing latency link call, tests and
  owner docs. Keep at most two candidate IDs in the existing bounded query.
- Out of scope: schema, product state, delivery behavior, public fields, new
  logging/monitoring, retries, provider calls and historical repairs.

## Risks and mitigations

1. Confusing the original input with the wake echo could change execution.
   Mitigation: composed tests preserve the actual echo mailbox and checkpoint.
2. Telemetry could overwrite another reply or cross member boundaries.
   Mitigation: reuse unchanged store ownership/write-once guards and their tests.

## Tasks

1. Confirm composition and inspect concurrent ownership.
2. Obtain and inspect the external patch; prove missing/present linkage.
3. Complete focused checks, scoped PR, final review and required CI.
4. Use only authorized canonical telemetry rollout and retain observation query.

## Decisions

- No open PR touches the relevant instant-first-turn, webhook wake or latency
  owners at discovery. Other functional and diagnostic PRs remain separate.
- Existing trace linkage receives only the rewritten echo mailbox; the original
  is still available before that rewrite. Reuse the existing trace link owner.
- Product UX and changelog: internal observation only. An accepted delivery link
  is not itself proof of handset delivery; downstream receipt remains required.

## Verification

- ReviewGPT authored the checksum-verified three-owner telemetry patch and tests.
- Six composed completion-to-wake cases fail against the original source because
  only the echo reaches the trace-link call. Corrected completion, wake and
  existing latency-store suites: 118 pass. Actual local PostgreSQL proof: 13 pass.
- Proof covers new/completed/resumed completion, failed/successful wakes,
  unchanged echo/checkpoint/Temporal/direct-ensure arguments, rejected and
  ambiguous sends, ordinary wakes, deduplication, post-response timing, optional
  trace failures, member/suspension/lane/kind ownership and write-once links.
- Original source bytes are restored after removing only telemetry context/link
  arguments; the shared trace store remains unchanged. One existing query handles
  at most two candidates, one additional derived trace, and no external work.
- Web typecheck, focused ESLint, whitespace, docs drift/gardening and complexity
  pass. Existing completion hotspot remains 37; diagnostic context adds no
  branches there and does not justify a broader functional refactor.
- Parent review: telemetry-only, no public identifiers/fields, new logging, schema,
  product state, provider call, wake behavior, retry or timeout change. Final
  ReviewGPT round 1 passes on `7a35f7ac06951e3c829578e2285b2b79ba2db193`
  with no findings; canonical preflight binds this exact head to PR #4029.
- Existing alert aggregation regression also passes: shared delivery traces count
  as one completed reply. Final plan closure changes documentation only; required
  final-head CI and canonical deployment remain pending.
Completed: 2026-10-05
