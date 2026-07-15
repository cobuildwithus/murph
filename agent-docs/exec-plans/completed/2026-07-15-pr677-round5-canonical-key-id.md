# PR 677 Round-Five Canonical Key ID

## Goal

Close the accepted ReviewGPT round-five finding without adding recovery state:
malformed encrypted-envelope key IDs must be rejected by the canonical parser
before historical-key lookup so deterministic persisted corruption cannot be
misclassified as a retryable outage and withhold foreground reply authority.

Also clarify the completion policy: accepted round-five findings may be fixed
and fully verified, but a sixth substantive ReviewGPT round requires a pause,
all other required gates green, a recorded retrospective, and explicit
continuation.

## Working Set

- `packages/runtime-state/src/hosted-storage.ts`
- `packages/runtime-state/test/hosted-storage.test.ts`
- focused Cloudflare reader and runner-route tests
- `agent-docs/operations/completion-workflow.md`
- `agent-docs/operations/pr-reviewgpt-loop.md`

## Verification Plan

- Prove whitespace-only, surrounding-whitespace, and unbounded key IDs fail at
  the canonical parser before any resolver call.
- Prove one malformed encrypted artifact reaches HTTP 422 and the existing
  terminal recovery path.
- Run focused tests, affected owner coverage/typechecks, required
  `coverage-write`, `pnpm test:diff`, privacy/diff checks, and CI.
- Do not start round six until every other completion gate is green and the
  explicit continuation decision is recorded.

## Outcome

- The canonical hosted cipher-envelope parser and writer now reject key IDs
  with surrounding whitespace or more than 256 characters before lookup or
  encryption.
- Reader coverage proves whitespace-only, surrounding-whitespace, and oversized
  persisted IDs become terminal without calling the historical-key resolver.
- The production runner route proves malformed encrypted metadata returns 422;
  existing runtime coverage proves that terminal disposition clears partial
  recovery and admits foreground work in the same invocation.
- Completion policy now permits fixing accepted round-five findings, then
  requires every other audit, verification check, and CI job green before an
  explicitly authorized sixth round.
- Required `coverage-write` found no unresolved gaps. Focused runtime-state and
  Cloudflare tests, affected typechecks/reverse-dependent tests, app verification,
  scenario integrity, architecture/privacy guards, and diff checks passed.

Status: completed
Updated: 2026-07-15
Completed: 2026-07-15
Completed: 2026-07-15
