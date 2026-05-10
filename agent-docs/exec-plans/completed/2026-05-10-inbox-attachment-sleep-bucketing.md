# Inbox Attachment Lookup And Sleep Bucketing

## Goal

Fix two narrow correctness bugs:

- direct inbox attachment commands must find attachments beyond the first 200 captures
- canonical wearable sleep sessions without `dayKey` must bucket to the intended sleep night

## Scope

- `packages/inboxd/src/kernel/sqlite.ts`
- `packages/inbox-services/src/inbox-app/types.ts`
- `packages/inbox-services/src/inbox-services/query.ts`
- focused inbox-service/inboxd tests
- `packages/query/src/wearables/canonical-records.ts`
- focused query wearable tests

## Constraints

- Keep lookup ownership in `inboxd`, which owns the runtime projection schema.
- Keep service code thin.
- Do not add broad new date abstractions unless the existing query path needs them immediately.
- Preserve unrelated dirty worktree edits.

## Verification

- `pnpm typecheck`
- focused package/diff coverage for inbox and query touched paths

Status: completed
Updated: 2026-05-10
Completed: 2026-05-10
