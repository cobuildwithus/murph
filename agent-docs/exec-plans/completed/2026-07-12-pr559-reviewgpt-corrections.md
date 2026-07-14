# PR #559 ReviewGPT Corrections

Status: completed
Created: 2026-07-12
Updated: 2026-07-13

## Goal

- Close the evidence-backed final-audit findings on PR #559 without widening
  the companion WHOOP boundary: accept exactly one 60-second compact RMSSD
  result, preserve first-envelope capture identity, keep disconnect authority
  fail-closed, and drain already accepted credential-free imports.

## Success criteria

- Late local heartbeats cannot clear a durable disconnect intent.
- `durationMs` accepts exactly `60000` and rejects other durations.
- A changed replay cannot replace the first accepted `captureId` envelope.
- An accepted compact RMSSD import survives disconnect without provider HTTP.
- Focused and affected package tests, typechecks, docs drift, required audits,
  final ReviewGPT, and GitHub checks pass at the pushed correction head.

## Scope

- In scope: companion observation contract; encrypted dirty-payload identity;
  hosted runtime job handoff; device-sync terminal job fencing; heartbeat
  disconnect sentinel; focused tests; matching architecture/security/product
  docs; PR #559 audit, CI, and review-state evidence.
- Out of scope: raw BLE/R-R upload; new provider APIs; iOS implementation
  changes; simulated physical-device evidence; unrelated base changes.

## Constraints

- Technical constraints: raw packets, R-R intervals, device identity, and Apple
  Health values remain on-device; only the derived envelope crosses ingress;
  provider-dependent jobs still stop at terminal account state.
- Product/process constraints: preserve unrelated work; use normal merge history;
  rerun final ReviewGPT after PR-specific corrections; keep the physical
  Developer-Mode limitation explicit and unsimulated.

## Risks and mitigations

1. Risk: relaxing the account execution fence could permit provider egress
   after disconnect.
   Mitigation: exempt only the exact Junction `companion_hrv_rmssd` resource,
   suppress batching, and prove zero provider HTTP in terminal-state tests.
2. Risk: replay identity could still depend on runtime ordering.
   Mitigation: reserve the encrypted pending row and runtime dedupe key by
   connection plus opaque `captureId`, then retain a non-health receipt with
   capture-key and strict-envelope hashes after pending work is acknowledged.

## Tasks

1. Implement and prove the heartbeat and exact-duration guards.
2. Implement and prove first-envelope capture identity.
3. Preserve accepted RMSSD jobs across disconnect at both handoff boundaries.
4. Run required verification, serialized deep review, final ReviewGPT, CI, and
   final-head mergeability checks.

## Decisions

- An accepted `202` creates a credential-free member-local import obligation;
  later Junction account liveness may cancel provider work but not that job.
- The first accepted envelope owns `captureId`; exact replay is idempotent and
  changed content conflicts. That ownership lasts until the connection is
  deleted rather than ending when pending work is acknowledged.

## Verification

- Focused hosted-web persistence, migration, privacy-deletion, wake, and
  heartbeat tests pass, including exact and changed replay after acknowledgement.
- Full contracts, device-syncd, and assistant-runtime suites pass; affected
  typechecks, `pnpm test:diff`, `pnpm docs:drift`, diff hygiene, and release
  package-shape verification pass.
- The serialized deep review found the post-ack replay gap; the durable
  hash-only receipt and its regression proof close that finding.
- Final ReviewGPT and GitHub final-head evidence run against the resulting
  closed-plan commit. The physical capture remains an explicit external proof
  limitation rather than simulated evidence.
Completed: 2026-07-13
