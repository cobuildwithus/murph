# PR 618 ReviewGPT Round 3 Fixes

## Goal

Resolve the two accepted ReviewGPT Round 3 findings for PR 618:

1. A proven pre-provider authority yield must restore an unprepared outbox
   intent's prior dispatch state and resume through the existing foreground
   continuation path instead of becoming a timed delivery retry.
2. Cross-turn reply ordering must use the route owner's canonical conversation
   equivalence predicate instead of a callback-local parallel identity system.

## Constraints

- Preserve fail-closed provider-entry authority and non-idempotent ambiguity
  handling after provider entry.
- Restore state only while the exact sending owner still holds the intent.
- Preserve source boundaries, source-less routes, email thread identity, Linq
  direct phone-to-chat continuity, group exact-target behavior, same-turn
  segments, and foreground priority after a real provider attempt.
- Add no persisted state, queue, scheduler, retry owner, or route identity.
- Keep PR 618 open; do not merge or deploy.

## Working Set

- `packages/assistant-engine/src/assistant/outbox.ts`
- `packages/assistant-engine/src/assistant/outbox/dispatch-state.ts`
- `packages/assistant-engine/test/assistant-outbox-runtime.test.ts`
- `packages/assistant-engine/test/outbox-dispatch-state.test.ts`
- `packages/assistant-runtime/src/hosted-runtime/callbacks.ts`
- `packages/assistant-runtime/test/hosted-runtime-callbacks.test.ts`
- `agent-docs/references/hosted-runtime-protocol.md`

## Verification Plan

- Focused assistant-engine proof for exact prior-state restoration, owner
  protection, rethrow behavior, and ordinary post-entry failure persistence.
- Focused assistant-runtime proof for Telegram and email pre-provider yields,
  cross-turn ordering, and canonical route equivalence.
- Affected owner test suites and typechecks.
- Required coverage-write and security/privacy refreshes, parent final review,
  exact-head CI, and ReviewGPT rerun to zero accepted findings.

## State

- Implementation and local verification complete on 2026-07-14.
- ReviewGPT Round 3 findings are resolved without adding persisted state,
  another retry owner, or a parallel route identity.
- PR 618 remains open; no merge or deployment is authorized.

## Evidence

- Focused assistant-engine proof passed: 90 tests across runtime dispatch and
  dispatch-state ownership cases.
- Focused assistant-runtime callback proof passed: 181 tests; canonical route
  owner proof passed: 10 tests.
- Assistant-engine typecheck and full owner suite passed: 148 files passed,
  1 skipped; 2,147 tests passed, 4 skipped.
- Assistant-runtime typecheck and full owner suite passed: 72 files and 1,653
  tests passed, 2 skipped.
- Cloudflare verify passed: 103 files and 1,781 tests.
- Dependency, workspace-boundary/cycle, stale-name, Temporal, crypto, raw-health,
  and affected-package typecheck guards passed. The broad lane's untouched
  setup-cli Venice wizard keystroke failure passed immediately in isolation.
- Runner assembly-only proof passed: entry 927,040 B, static boot closure
  6,826,809 B, total 8,725,515 B; all remain within budget.
- Coverage-write strengthened the positive restoration test with non-default
  prior retry state and found no additional behavior gap.
- Security/privacy found no evidence-backed medium-or-higher issue; diff,
  sensitive-data, identifier, and prohibited-cast scans passed.
Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
