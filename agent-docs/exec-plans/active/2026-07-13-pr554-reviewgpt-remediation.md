# PR 554 ReviewGPT remediation

Status: active — ReviewGPT round 2 remediation implemented
Created: 2026-07-13
Updated: 2026-07-13

## Goal

Make the first disconnect-lease rollout release safe and mergeable by deleting
the newly exposed hosted conversational disconnect consumer while retaining
safe account inspection/reconcile and every lease-aware writer guard.

## Success criteria

- The hosted assistant, loopback CLI bridge, Cloudflare port, and signed web
  callback expose account show/reconcile only; no model-controlled request can
  reach provider revoke in the guard-only release.
- Existing browser-owned disconnect behavior remains available during the
  two-release drain and is not silently degraded.
- The later activation contract explicitly requires trusted later-turn scoped
  approval, durable lease-before-provider ordering, canonical ambiguous-result
  propagation, and bounded post-expiry recovery before hosted disconnect is
  reintroduced.
- Focused tests prove hosted disconnect is unavailable while show/reconcile
  work, and existing browser disconnect plus lease writer guards remain intact.
- Affected tests/typechecks, exact-head CI, and a new exact-head ReviewGPT round
  pass before the PR is marked ready.

## Scope

- Hosted device account action contracts and adapters in CLI, assistant
  runtime, hosted execution, device-syncd, Cloudflare, and web.
- Assistant prompt guidance, rollout docs, and directly matching tests.
- No new table, queue, background worker, confirmation service, or state owner.

## Decisions

- Default to deletion: do not leave a dormant model-supplied confirmation
  protocol wired behind the production lease source gate.
- Preserve the existing browser disconnect path for rollout compatibility;
  only the new hosted conversation consumer is removed.
- Keep the expand-only lease columns and writer guards as the rollback floor.
- Describe this head as the prerequisite writer-guard release, not as completed
  production lease activation; activation still requires the documented alias
  verification and prior-function drain.
- Carry expected absence or the exact starting account epoch across companion
  SDK provider work, and treat any disconnect evidence as a terminal fence for
  credential-bearing runtime snapshots.
- Treat trusted conversational approval and canonical ambiguous recovery as
  activation prerequisites, not speculative phase-one machinery.
- The user explicitly prohibited subagents, so required review passes are
  performed manually in this owner session.

## Tasks

1. Collapse hosted account-action contracts to show/reconcile only.
2. Reject hosted CLI disconnect locally and remove assistant disconnect
   guidance while preserving the local/browser account command.
3. Update rollout and command-surface docs with the activation prerequisites.
4. Regenerate CLI artifacts and run focused tests/typechecks plus manual
   security, coverage, and simplification review.
5. Finish the scoped commit, guarded-push, rerun exact-head CI and ReviewGPT,
   validate findings, and mark PR #554 ready only when all gates pass.

## Verification

- Focused CLI, assistant-runtime, hosted-execution, device-syncd, Cloudflare,
  web authority/wake/migration, and assistant prompt suites.
- Affected package/app typechecks and canonical CLI schema generation.
- `git diff --check`, privacy/identifier scan, exact-head CI, and ReviewGPT.

Round 2 validation accepted the delayed companion ensure and credential export
findings. The production-lease finding was narrowed to rollout labeling because
enabling claims before the prerequisite deployment drain would violate the
documented two-release contract. Focused remediation evidence: device-syncd
public ingress 61 tests; hosted runtime authority 42 tests; Prisma connection
store 42 tests; hosted runtime terminal hydration 2 selected cases; affected
device-syncd, assistant-runtime, and web typechecks pass.

Round 3 accepted three additional findings. Prisma now serializes every
owner/provider upsert and validates SDK guards against that row before resolving
the provider-returned external identity, preserving reconnect after identity
scrubbing and rejecting delayed expected-absence activation. Lease-less terminal
writes raw-check for newly claimed evidence, while recovered terminal rows flow
through the canonical transaction that consumes their lease. Credential-bearing
snapshots use raw non-null lease evidence, including blank or malformed owners.
The later activation contract now requires a shared runtime gate: deploy it off,
verify and drain, enable without an alias change, then disable and drain before
rollback. Focused web evidence: 157 tests and the prepared web typecheck pass.

The first exact-head round after Round 3 was discarded because its attached PR
manifest was stale and belonged to another lane. A fresh repo-wrapper round with
an independently hash-verified PR #554 manifest accepted one finding: guarded
Junction reconnect restored the encrypted external identity on a scrubbed row
without restoring its durable routing blind index. The existing-row update now
writes both representations atomically, and focused coverage proves the same row
is reused and immediately resolves through the real external identity. Focused
Prisma-store evidence: 43 tests pass.
