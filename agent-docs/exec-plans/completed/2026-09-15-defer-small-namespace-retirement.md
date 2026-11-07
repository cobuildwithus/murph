# Defer dormant runner namespace deletion to unblock releases

Status: completed
Created: 2026-09-15
Updated: 2026-09-15

## Goal

Restore ordinary version-based deployment after the experiment removal introduced
an unapplied destructive Durable Object migration. Ship the already-reviewed
warm-wake latency fix without requiring namespace deletion.

## Constraints and decisions

- Physical deletion is unnecessary for the requested latency improvement.
- Retain the historical namespace, its bound-target routing and existing native
  application unchanged. Reject every fresh experimental binding and preparation.
- Do not restore selection, hashing, experiment configuration, provisioning or
  dedicated rollout machinery. Reuse ordinary native application retention.
- Preserve typing placement, checkpoints, runtime identity, release admission
  and protected production deployment. No rollback or local production secrets.

## Tasks

1. Prove ordinary Wrangler upload does not propose a migration.
2. Restore only dormant namespace compatibility and drain-only admission.
3. Verify retained native receipts, pending/bound target recovery and fresh
   regular allocation; run focused tests and relevant typechecks.
4. Obtain final ReviewGPT PASS and exact-head CI, merge and deploy.
5. Verify live release and smoke before requesting new warm-message evidence.

## Evidence

- The existing cleanup PRs are merged; no active retirement PR, deployment or
  task-specific local checkout was found. Their handoff did not establish
  persisted-target retirement.
- Installed Wrangler regression reproduced a v9-to-v10 delete in an ordinary
  upload before the fix; the retained-v9 upload passes without migrations or
  Container API requests afterward.
- 438 focused Cloudflare tests passed, covering SQLite ownership, retirement,
  regular allocation, native retention and deployment controllers. The local
  harness environment and cleanup suites total 120 passing tests after aligning
  the expected retained class inventory.
- Cloudflare and local-harness typechecks passed. Documentation drift/gardening,
  whitespace checks and the complexity ratchet passed; existing hotspot debt
  is unchanged.
- Implementation is complete. Final ReviewGPT, exact-head CI, merge and live
  deployment verification remain completion gates tracked on the resulting PR.

Completed: 2026-09-15
