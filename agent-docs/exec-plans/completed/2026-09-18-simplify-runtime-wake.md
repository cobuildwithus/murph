# Remove redundant status reads before warm runtime wakes

Status: completed
Created: 2026-09-18
Updated: 2026-09-18

## Goal and protected invariant

Remove the serial native invocation receipt read from successful warm wakes.
Keep Postgres admission and exact attempt/generation fencing authoritative;
uncertain wakes must not release or replace live work.

## Evidence and architecture

The orchestrator currently reads the invocation receipt before calling the
native wake, which already validates the exact running attempt. This adds an
avoidable RPC to every warm message. Reorder these existing operations: return
on an accepted wake, then read completion evidence only for recovery. Keep the
Web claim callback because it supplies canonical ownership and admission.
No new state, protocol, configuration, dependency, or service is needed.

## Scope and failure behavior

Change the Cloudflare Postgres orchestrator and its focused regression proof.
Preserve foreground promotion, completed-owner reconciliation, retirement,
mode conflicts, launch uncertainty, and all existing command budgets. An
unconfirmed wake still checks for settled completion before returning retry.
Retiring owners and retention owners requiring replacement are never woken.
No production changes or removal of the durable Temporal wake are authorized.
The larger Worker dispatch delay is outside this bounded correction.

## Product UX journeys

- Live conversation: wake the exact runtime without a prior receipt read.
- Background mailbox work: promote foreground work in the same live runtime.
- Completed work: recover a lost callback and reuse the retained warm shell.
- Uncertain or stopping work: preserve authority until existing recovery proves
  completion or exact native retirement.
- Maintenance mode: retain the existing conflict and retirement behavior.

## Tasks

1. Reorder existing wake and receipt recovery without changing authority.
2. Prove accepted wakes skip reads; preserve completion and retirement cases.
3. Run focused orchestration/container tests, Cloudflare typecheck, and complexity.
4. Review the full diff, update the owner document, and make a scoped commit.

## Verification

- Runtime orchestration, owner completion, and native container suites: 277 tests
  passed. After the final orchestration reorder, its two affected suites passed
  again (27 tests); native container implementation was unchanged.
- Regression proof: the live-owner test fails against the original source because
  it observes the redundant receipt read, and passes with the correction.
- Cloudflare and Web typechecks passed. The fresh checkout first needed the
  standard Web Prisma generation prerequisite before Cloudflare typechecking.
- Changelog rendering: 10 tests passed using repository-root Vitest discovery.
  The documented app-directory invocation found no files; reused existing Frog
  report `20260912202546-changelog-focused-test` rather than adding a duplicate.
- `pnpm complexity:diff`: passed; maximum remains 19, no debt above 20.
  The final implementation keeps successful wake dispatch in the existing
  orchestrator and eligibility in the existing wake helper.
- `pnpm docs:drift` and whitespace checks passed.
- Product UX: Ready at the deterministic runtime boundary. Live foreground
  promotion, completed-owner warm reuse, unknown liveness, retention conflicts,
  and exact retirement are covered. No prompt, tool, context, or reply policy
  changed, so model-generated reply proof is not applicable.
- Changelog: `warm-conversation-wake`; content only, existing rendering retained.
- Parent review: no new protocol, state, dependency, or service; canonical Web
  admission and native exact-owner fencing remain required. Successful wakes
  remove one awaited receipt RPC; recovery keeps the existing command budget.
- Scope ends at a local reviewed commit. CI and required final ReviewGPT remain
  PR-stage gates if a PR is requested. No deployment was performed; actual
  production latency and the separate Worker dispatch delay remain unverified.
Completed: 2026-09-18
