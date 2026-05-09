# Hosted Mailbox Progress Supervisor

## Goal

Make hosted mailbox recovery depend on one durable web-owned predicate:
mailbox high-water per lane is greater than checkpointed imported sequence.

Success means mailbox-backed ingress is not considered handled just because
Cloudflare accepted a nudge or a foreground runner emitted a deferred import log.

## Constraints

- Preserve web-owned mailbox ordering and workspace checkpoint ownership.
- Do not introduce a second dispatch queue, Cloudflare mailbox cursor, or run ledger.
- Treat runtime logs as diagnostics, not scheduling truth.
- Avoid overlapping active Cloudflare runner and assistant-runtime work unless required.
- Do not expose provider payloads, contact identifiers, raw message content, or secrets.

## Current Shape

- `hosted_mailbox_item` is durable and ordered by `(userId, lane, laneSeq)`.
- `hosted_workspace.redacted_status_json` is the durable checkpoint status surface.
- `hosted_runtime_log` can contain observed `mailbox.imported` events, including
  foreground imports that explicitly deferred checkpointing.
- Existing workflow/direct nudge paths stop at runner nudge acceptance.

## Implementation Plan

1. Add a narrow web-owned helper for checkpointed mailbox progress and expected item lag.
2. Make mailbox-backed webhook workflow retry until the expected mailbox item sequence is
   checkpointed, not just until the runner nudge is accepted.
3. Make mailbox-backed ingress always start the pointer workflow; direct nudge may remain
   only as a latency optimization.
4. Change lag sweeper/status computation to keep checkpointed lag separate from observed
   import logs.
5. Update focused tests for direct nudge acceptance, deferred import logs, and expected seq
   supervision.

## Verification Plan

- Focused hosted web tests for handoff, workflows, status, and lag sweeper.
- `pnpm test:diff` or the narrowest truthful app/package verification available after
  implementation.
- Required security/privacy, coverage, and final review audits per repo workflow.

## Progress

- Implemented checkpointed mailbox progress as the only supervisor/status/sweeper
  predicate; runtime logs remain diagnostics only.
- Webhook handoff now always starts the pointer workflow after mailbox append; direct
  nudge remains only a latency optimization.
- Pointer workflow starts before direct nudge, nudges once, then waits for the exact
  mailbox item lane sequence in a separate poll-only checkpoint step.
- Pointer workflow no longer decrypts mailbox payloads or sends provider-visible read
  receipts; that belongs behind durable assistant handling evidence.
- Lag sweeper uses checkpointed workspace progress only and applies a freshness/retry
  cadence so it remains a recovery backstop instead of extending the normal quiet
  checkpoint path.
- Focused hosted web tests, targeted lint, and `apps/web` typecheck passed.
Status: completed
Updated: 2026-05-09
Completed: 2026-05-09
