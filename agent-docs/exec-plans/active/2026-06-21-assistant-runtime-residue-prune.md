# Assistant runtime residue pruning

Status: active
Created: 2026-06-21
Updated: 2026-06-21

## Goal

Bound assistant-runtime file growth and reduce hosted snapshot enumeration and extraction cost without adding a database, archive format, scheduler, configuration surface, or generic garbage-collection framework.

## Architecture

- Keep the existing receipts, accepted-input journals, input events, terminal evidence, outbox, sessions, and transcript schemas.
- Add one assistant-engine lifecycle compactor with explicit inventory, planning, and ordered deletion.
- Require the hosted pending-input index before deleting input events, accepted-input journals, or terminal evidence.
- Let ordinary assistant maintenance run the same compactor conservatively without hosted pending authority, pruning only independently settled residue.
- Run the full pending-index-backed compactor before hosted idle snapshot enumeration.
- Retain unresolved input, delivery, provider-cleanup, and malformed/ambiguous state.
- Keep terminal audit and evidence residue for 14 days or the newest 100 records/groups.

## Safety order

1. Delete settled accepted-input journals.
2. Delete eligible input events.
3. Delete bounded terminal receipts.
4. Delete complete settled evidence groups only after their input-event deletions succeed.
5. Delete intent provenance only after the referenced outbox record is gone.

A failed pass is idempotent and leaves additional residue rather than weakening replay or delivery safety.

## Scope

- `packages/assistant-engine/src/assistant/runtime-residue.ts`
- assistant maintenance integration and owner export
- focused assistant-engine coverage
- hosted pending-index/snapshot cleanup composition
- focused assistant-runtime coverage
- accepted-turn state descriptor and obsolete hot-state include cleanup
- architecture and hosted runtime protocol documentation

## Non-goals

- No monthly archive.
- No new persisted schema.
- No receipt/journal merge.
- No canonical terminal-group rewrite.
- No SQLite or persisted alias index.
- No session or Codex rollout pruning.

## Verification

- package typechecks and coverage-bearing focused tests
- pending, malformed, partial-evidence, provider-cleanup, active-outbox, journal, retention, provenance, idempotency, and snapshot-order scenarios
- `git diff --check`
- security/privacy, coverage, deep-review, and external PR review loops
