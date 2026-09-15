# Snapshot download transport diagnostics

Status: completed
Created: 2026-09-14
Updated: 2026-09-14

## Goal and invariants

Explain slow cold-restore downloads using transport milestones and storage request
correlation. Preserve fetch implementation, authentication, streaming, timeouts,
retries, and foreground ordering. Exclude URLs, object keys, credentials, response
bodies, addresses, and workspace content from diagnostics.

## Evidence and owner

The snapshot reader records total time to headers and body timing but cannot
separate connection setup from waiting for a response. Extend that Node owner
with passive diagnostic subscriptions and safe response-header metadata.
No new persisted state or external call is needed.

## Tasks

- [x] Add scoped DNS/TCP/TLS/request observations and process CPU/event-loop deltas,
  with a settled-header event for successful and rejected downloads.
- [x] Correlate header/body events by attempt ordinal and bounded storage request IDs.
- [x] Prove delayed lookup/headers, concurrency, reused connections, cancellation,
  cleanup, and credential exclusion using synthetic inputs.
- [x] Update the reliability owner; run focused tests, typecheck, privacy and
  complexity checks; review the diff and make a scoped local commit.

## Limits and compatibility

Unobserved transport timings remain nullable. Response wait includes network
transit and server work. CPU/event-loop deltas include other process activity.
Listeners must be released after the header wait and cannot change fetch outcomes.
Additive logs require no reader migration. No deployment or product change.

## Verification

- Passed: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/workspace-snapshot-fetch-diagnostics.test.ts apps/cloudflare/test/runner-platform.test.ts -t 'snapshot' --no-coverage`
  (42 passed; unrelated platform cases excluded).
- Passed: `pnpm --filter @murphai/cloudflare-runner typecheck`.
- Passed: `pnpm logs:guard`, `pnpm complexity:diff`, and `git diff --check`.
  New source maximum complexity is 17; the existing upload hotspot is unchanged.
- Direct synthetic proof uses native fetch with real loopback HTTP connections
  for delayed lookup/headers, reuse, overlapping requests, cancellation, streaming,
  and failed lookup. TLS milestone capture uses Node socket events in a unit test.
  Existing encrypted-restore retry tests prove attempt/request-ID correlation.
- Parent review: additive logs, bounded socket listeners, exact request attribution,
  error preservation, no sensitive payloads, and unchanged transport/retry owners.
- Internal diagnostics only; no public changelog or assistant journey. No new
  awaited network, database, or provider operation. No protocol or state migration.
- PR, CI, and deployment were not performed in this local implementation task.
Completed: 2026-09-14
