# PR 517 ReviewGPT Round 2 Fix

## Goal

Prevent a disconnect command for connection generation G from revoking or
deleting a later reconnect generation G+1, including when the disconnect waits
behind the reconnect provider mutation or is retried after an ambiguous first
response.

## Constraints

- Carry one narrow stable generation precondition from the control-plane
  client through provider revoke and the local disconnect transaction.
- Keep scheduler and worker observation revisions independent from connection
  lifetime identity.
- Preserve same-generation repeated-disconnect idempotency.
- Return a retryable 409 before provider or database side effects when the
  requested generation is stale.
- Keep the existing single provider mutation owner; add no queue, schema, or
  lifecycle manager.

## Working Set

- `packages/device-syncd/src/{http,service,store}.ts`
- `packages/device-syncd/src/store/accounts.ts`
- `packages/device-syncd/test/{http,service,store}.test.ts`
- `packages/operator-config/src/device-sync-client.ts`
- `packages/operator-config/test/http-linq-device-runtime.test.ts`
- `packages/cli/src/device-services.ts`
- `packages/cli/test/device-cli.test.ts`

## Verification Plan

- Add production-faithful failing regressions for queued stale disconnect and
  same-generation retry after reconnect.
- Run device-sync service and HTTP tests, operator-config client tests, package
  typechecks, owner coverage, required completion audits, and `git diff --check`.
- Push the updated head and rerun ReviewGPT until it returns no accepted
  findings.

## Outcome

- Disconnect requests now carry the observed `connectedAt` generation from the
  CLI through the HTTP client and service.
- The service revalidates that generation after provider-mutation admission,
  before provider revoke, and again in the same transaction that disconnects
  the account and dead-letters its pending jobs.
- The guarded operation uses a distinct endpoint path, so mismatched CLI and
  long-lived daemon versions fail closed instead of falling back to the old
  unguarded disconnect behavior.
- Stale queued or retried disconnects fail with retryable 409 responses without
  revoking the replacement connection or changing its account and job state.
- Same-generation repeated disconnects remain idempotent.

## Verification

- Device-sync service, HTTP, and store tests: 164 passed.
- HTTP regression proves the legacy unguarded endpoint returns 404 without
  calling the disconnect service.
- Operator-config client tests: 24 passed.
- CLI device tests: 17 passed.
- Package coverage suites: device-syncd 732 passed, operator-config 191 passed,
  CLI 1,045 passed.
- Typechecks passed for device-syncd, operator-config, and CLI.
- Security audit found zero critical, high, or medium findings.
- Privacy scan and `git diff --check` passed.
Status: completed
Updated: 2026-07-10
Completed: 2026-07-10
