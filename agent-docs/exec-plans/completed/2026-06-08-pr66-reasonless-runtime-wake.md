# PR66 Reasonless Runtime Wake Cleanup

## Goal

Remove the remaining product `reason` hint from the hosted runtime wake boundary in PR66.

## Context

- PR66 already hard-cuts `/demand`, signal `source`, and product demand decisions from Temporal.
- The remaining `reason` field still crosses Temporal to Cloudflare and Cloudflare to the local runtime.
- The intended invariant is that Temporal schedules, Cloudflare wakes, and runtime behavior derives from mailbox/workspace facts.

## Scope

- Remove `reason` from ensure-processing request/activity inputs.
- Remove `reason` from hosted workspace runtime job requests and parsers.
- Remove Cloudflare write-fence/runtime-invocation reason propagation.
- Derive scheduled runtime behavior from workspace wake facts instead of request reason.
- Update tests and docs if needed.

## Out of Scope

- Dropping the inert `active_reason` SQLite column.
- Changing the Temporal hard-cut deploy runbook.
- Adding new scheduling or fallback behavior.

## Verification

- Focused hosted-execution, Temporal, assistant-runtime, and Cloudflare tests.
- `pnpm hosted-temporal:guard`
- `pnpm typecheck`
- `pnpm test`
Status: completed
Updated: 2026-06-08
Completed: 2026-06-08
