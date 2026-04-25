# Hosted Local Typing Simplification

## Goal

Delete the hosted run-owned messaging-activity system and rely on the local assistant channel typing lifecycle for hosted Linq and Telegram turns.

Success criteria:

- Queue-only assistant turns no longer suppress local channel typing.
- Hosted runtime supplies the narrow channel typing env/dependency seam needed for Telegram platform env without globally exposing platform secrets.
- Hosted run-level messaging activity ownership, Durable Object handles, internal stop routes, and executor-owner env sentinels are removed.
- Focused tests prove queue-only local typing and hosted Linq/Telegram first-contact typing behavior still work.

## Constraints

- Preserve queue-only durable delivery semantics.
- Do not merge platform env into global hosted `process.env`.
- Do not log or fixture raw hosted/member/chat identifiers, contact identifiers, provider payloads, secrets, or local paths.
- Preserve unrelated active Cloudflare and hosted runtime work in the dirty tree.

## State

Implementation, required audits, and scoped commit complete. The commit used patch-only staging for mixed Cloudflare files so unrelated active local-proxy/env hunks stayed out of the commit.

## Done

- Read required repo routing, completion, verification, security, and reliability docs.
- Confirmed Linq and Telegram already share the local assistant channel typing abstraction.
- Mapped the hosted run-owned messaging activity call graph and queue-only suppression point.
- Moved assistant channel typing into a shared helper and removed the queue-only suppression.
- Added a hosted channel typing dependency seam for Linq/Telegram env injection.
- Removed hosted run-owned messaging activity start/stop ownership from runtime and Cloudflare runner paths.
- Updated focused assistant-runtime, assistant-engine, hosted-execution, and Cloudflare tests for the simpler typing ownership model.
- Added direct notification-turn typing proof.
- Fixed final-review finding by passing a hosted-lifetime abort signal into channel typing dependencies and aborting it when run execution exits.
- Required audits completed: simplify (no findings), security/privacy (no findings), coverage-write (no edits), task-finish-review (medium abort-signal finding fixed).
- User requested a commit after the initial no-commit handoff; staged only task hunks and left unrelated dirty work unstaged.

## Now

- Commit the staged task-only diff.

## Next

- Handoff with commit id, verification results, audit results, and remaining unrelated dirty-work note.

## Open Questions

- None currently.

## Working Set

- `packages/assistant-engine/src/assistant/**`
- `packages/assistant-runtime/src/hosted-runtime/**`
- `apps/cloudflare/src/**`
- Focused `packages/assistant-engine/test/**`, `packages/assistant-runtime/test/**`, and `apps/cloudflare/test/**`
- `agent-docs/exec-plans/completed/2026-04-26-hosted-local-typing-simplification.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
Status: completed
Updated: 2026-04-26
Completed: 2026-04-26
