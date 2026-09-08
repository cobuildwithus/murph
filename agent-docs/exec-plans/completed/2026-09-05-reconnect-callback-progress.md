# Preserve reconnect progress at the OAuth callback boundary

Status: completed
Created: 2026-09-05
Updated: 2026-09-05

## Cause and correction

ReviewGPT found that exhausted classification retries enter failed-setup cleanup.
That replacement upsert can finish the backlog and disable the active connection.
Handle the exact pending error before cleanup at the existing callback owner.
Keep the consumed claim unresolved; never replay provider code or reset the claim.
No new state, abstraction, retry loop or cleanup owner is needed.

## Product behavior and verification

Exercise the actual callback with the PostgreSQL control-plane store: 801 rows
finalize; 1601 retain annotations, payloads, old credentials, status, epoch and
exact consumed claim with no cleanup or revocation. Redelivery is replay-fenced
and expired claims require existing recovery. Genuine failures retain cleanup.
Run focused Web and device-syncd tests, both typechecks, lint, complexity and
privacy checks. Push, then run round-two ReviewGPT concurrently with CI.

## Proof and final review

The 1601-row callback regression fails on the previous callback source: failed
setup cleanup deletes 800 payloads. Both PostgreSQL callback cases pass with the
correction. All 83 public-ingress tests, including genuine-failure cleanup,
and 58 Web OAuth-connection tests pass. Web and device-syncd typechecks pass.
Web scoped ESLint and complexity guard pass; device-syncd has no ESLint lane.
The cleanup admission assertion adds no complexity debt to the existing callback
owner and no new state, provider call or replay authority. Privacy/diff review
is clean. Product UX: Ready for review; expired claims retain existing recovery.
Completed: 2026-09-05
