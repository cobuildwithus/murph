# Inbox media retention

Status: completed

## Goal

Add automatic 14-day retention for raw inbox image/audio/video bytes while
preserving canonical attachment metadata and parser derivatives.

Success criteria:

- Raw `raw/inbox/**` image/audio/video attachment bytes older than 14 days can
  be expired by an inbox-owned primitive.
- Expiration is represented by one append-only, versioned retention record; the
  original inbox capture record remains unchanged.
- Readers/validators distinguish intentional expiration from corruption.
- Hosted runtime invokes the primitive once during existing idle checkpoint work,
  without adding a scheduler, service, or configurable policy surface.
- Tests cover eligibility, idempotency, SHA mismatch, expired read state, and
  hosted checkpoint wiring.

## Constraints

- Default to deletion and radical simplicity.
- Do not add a generic lifecycle registry, policy engine, new daemon, cron, or
  persistent pin state.
- Documents/PDFs stay out of the 14-day media policy.
- Sensitivity does not extend raw media retention.
- Retention logs must be metadata-only and avoid exposing raw payloads.

## Proposed shape

- Add `ledger/inbox-attachment-retention/YYYY/YYYY-MM.jsonl`, sharded by the
  retention event `purgedAt` month.
- Add a small inbox projection state:
  `available | retention_expired` over the existing stored/unstored raw path.
- Add an idempotent, bounded `runInboxMediaRetention({ vaultRoot, now })`
  primitive in `packages/inboxd`; the final tombstone/delete decision rechecks
  durable refs and file integrity under the canonical write lock.
- Call that primitive once from the hosted idle-checkpoint path before snapshot
  publication, using the existing wake/shutdown cancellation path.

## Verification plan

- Focused package tests for contracts/inboxd/assistant-runtime surfaces.
- Focused prompt test proving prepared auto-reply lifecycle text does not
  advertise stale expired raw paths.
- Focused runtime test proving wake cancellation aborts retention before
  compaction.
- `pnpm typecheck`
- `pnpm test:diff <changed paths>`
- `pnpm test:smoke`
Updated: 2026-06-21
Completed: 2026-06-21
