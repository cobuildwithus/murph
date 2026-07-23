# PR 859 ReviewGPT round 4 terminal-recovery retrospective

Status: completed
Created: 2026-07-22
Updated: 2026-07-22

## Goal

- Preserve the original product requirement: after one automatic meal closeout
  intent loses recipient authority, make zero provider calls to its obsolete
  route and let the existing pending occurrence plus ordinary cron backoff own
  the sole fresh attempt against current Web routing.
- Remove the generic terminal-failure-to-assistant-input ownership transition
  for that typed authority-loss outcome, without changing unrelated delivery
  failure notes.

## Requirement-level retrospective

- The first-reviewed design installed one private 9pm closeout, retained
  structured nutrition, removed eligible automatic photo bytes, and delivered
  one summary to the member's private conversation.
- Review remediation centralized mutable recipient authority in Web routing and
  added a provider-entry stale-target rejection, then preserved the pending
  occurrence so cron could retry against the current route.
- The repeated mechanism is broader than cron reconciliation: generic terminal
  delivery recovery also converts every non-retryable direct-channel failure
  into a new replyable assistant input rooted in the failed intent's saved
  route. For closeout authority loss, that creates a second delivery owner and
  bypasses the closeout-only provider guard.
- Decision: continue the round-2 single-owner redesign by deletion. The typed
  stale closeout outcome must not enter generic terminal-failure-note recovery.
  The existing pending occurrence, cron backoff, and live Web route resolver
  remain the only recovery path. Add no route snapshot, queue, repair state,
  reconciliation loop, or replacement recovery mechanism.

## Tasks

1. Reproduce the stale-route failure through hosted post-checkpoint terminal
   failure staging and prove the obsolete route can become a replyable input.
2. Suppress only the automatic-meal closeout's typed stale-route outcome before
   generic terminal-failure input staging; preserve unrelated failure notes.
3. Extend production-path proof through the hosted next-wake boundary, cron
   retry, and one current-route send.
4. Update durable authority/reliability disclosures and the PR retrospective,
   run canonical verification, commit, push, and start ReviewGPT round 5 with
   CI.

## Verification

- Pre-fix hosted post-checkpoint regression failed with one staged replyable
  failure input for the typed stale closeout route, reproducing the accepted
  finding.
- Hosted workspace assistant phase: 249 passed.
- Hosted runtime callbacks: 202 passed.
- Assistant cron runtime: 141 passed.
- Assistant-runtime and assistant-engine typechecks passed.
- Canonical diff verification passed on one Crabbox Testbox: repository guards,
  package boundaries, owner typechecks, assistant-runtime (1,797 passed, 2
  skipped), and affected Cloudflare verification (1,858 Node plus 1 Worker).
  The prior fixed-path diagnostics collision did not reproduce in isolation.
- Full acceptance verification passed on the same Testbox: all workspace
  package coverage and boundary checks, Web production build, Cloudflare Node
  (1,858 passed), and Cloudflare Workers (1 passed).
- Parent final review traced capture admission, managed opt-in, live-route
  authority, terminal-failure staging, cron retry, and receipt-guarded photo
  removal; it found no remaining PR-specific defect before the final gate.
Completed: 2026-07-22
Completed: 2026-07-22
