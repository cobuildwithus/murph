# PR 558 Final Audit Corrections

## Goal

Resolve the two accepted final ReviewGPT findings for PR 558 without weakening
self-service hosted-group departure:

1. Derive leave and newsletter opt-out identity from canonical Web-owned
   mailbox envelopes and the current group route, never model-writable runtime
   metadata.
2. Return after the durable leave/revoke transaction instead of awaiting a
   best-effort runtime wake that can remain pending after commit.

## Constraints

- Preserve live and replayed current Linq group-message self-opt-out.
- Fail closed for missing, expired, consumed, mixed-sender, mixed-thread,
  direct, self-authored, non-Linq, or stale-route mailbox evidence.
- Keep departure available when the participant or group runtime is inactive;
  inactivity must not trap a member in the group.
- Keep the durable revoke mailbox items as cleanup truth and add no replacement
  queue, timer, or detached lifecycle machinery.
- Remove the obsolete mutable sender-proof contract and propagation path.
- Preserve Web-first deployment compatibility for the pre-existing newsletter
  opt-out action by ignoring legacy sender fields and canonically checking the
  bounded pending mailbox frontier until old runner containers are drained.

## Working Set

- `packages/hosted-execution/src/{runtime-control,parsers/runtime-control}.ts`
- `packages/assistant-engine/src/assistant/**`
- `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts`
- `apps/web/src/lib/hosted-mailbox/store.ts`
- `apps/web/src/lib/hosted-groups/group-tool.ts`
- Focused tests and hosted-group durable documentation

## Verification Plan

- Focused hosted-execution parser, assistant engine, assistant runtime, Web
  group-tool, and mailbox-store tests.
- Typecheck hosted execution, assistant engine, assistant runtime, and Web.
- Scoped Web ESLint, docs drift, diff check, privacy scan, and parent final
  review.
- Commit and push the corrected PR-specific head, wait for CI, then run exactly
  one substantive ReviewGPT audit on that exact head. Resolve all findings and
  repeat only if another PR-specific correction changes the audited head.

## Outcome

- Removed persisted sender-proof generation and propagation from assistant
  automation, delivery context, and hosted runtime group-tool wiring.
- Added canonical pending mailbox decode plus current Linq route verification
  at the Web-owned self-opt-out boundary.
- Kept the legacy newsletter request shape only as an ignored-value rollout
  shim backed by the same canonical pending frontier.
- Deleted awaited post-commit cleanup signaling; durable revoke mailbox items
  remain the cleanup source of truth.
- Focused tests, four affected typechecks, scoped Web ESLint, docs drift, diff
  check, and privacy scan passed. The PR-lane final audit follows on the pushed
  correction head.
Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
