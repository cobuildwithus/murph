# PR 554 ReviewGPT remediation

Status: active
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

