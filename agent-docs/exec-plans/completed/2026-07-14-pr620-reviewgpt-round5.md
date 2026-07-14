# PR 620 ReviewGPT Round 5

## Goal

Prevent rejected native resume identities from being persisted as valid, and
delete the hosted diagnostic model whose fresh-thread fallback producers were
removed in the preceding round.

## Scope

- Publish provider thread metadata only after `thread/resume` or `thread/start`
  is accepted and its execution context is validated.
- Keep a requested resume identity available only for request routing and
  redacted diagnostics before provider acceptance.
- Delete fresh-thread-fallback and invalid-output-fallback diagnostic consumers,
  allowlists, fields, and fixtures across assistant runtime, hosted execution,
  and web storage.
- Reject the unrelated proposal for a new cross-turn ambiguity lifecycle: the
  automation retry path is unchanged by this PR and the proposed state machine
  is outside this deletion-focused change.

## Verification

- Run focused assistant-engine, assistant-runtime, hosted-execution, and web
  tests plus affected package typechecks.
- Run the required coverage/write and security/privacy audits.
- Commit, push, require green CI, and run ReviewGPT on the new exact head.
Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
