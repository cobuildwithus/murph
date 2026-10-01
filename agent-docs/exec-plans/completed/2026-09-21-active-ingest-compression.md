# Compress large active ingest journals

## Outcome and invariant
Bound current-month plain ingest storage using the existing verified Brotli archive
representation. Preserve every receipt and evidence byte, ordinary device writes,
exact replay, interrupted archive recovery and full query SQLite restore.

## Existing owner and scope
The idle maintenance owner already compresses closed months. Its writer already
supports receipt-backed archived amendments. Opt this caller into current-month
archival once the plain shard reaches 4 MiB. Smaller active shards and all future
months stay plain. Existing callers retain closed-month defaults.

## Failure and evolution
Canonical locking, verified exclusive archive publication and receipt-backed
amendment/replay remain the only owners. Extend exact duplicate recovery to the
current month so an interrupted publication can converge. Mismatched duplicates
remain errors. No new format, registry, periodic timer or compression dependency.
The existing archive size caps and maintenance abort signal remain effective.

## Product UX and proof
Internal physical representation change; unchanged receipt contents and query
behavior. Prove active threshold, future exclusion, exact decompressed bytes,
append after compression, repeated no-op, conflicting recovery and idle caller
wiring. Test current-device import into an archived active month and report cost.
Focused core/runtime tests and typechecks; parent review, CI and ReviewGPT.

## Local completion evidence
Core integration-ingest suite: 42 passed. Hosted idle-maintenance suite: 49 passed.
Core and assistant-runtime typechecks passed. Complexity guard passed with no debt
increase; existing hotspots are unrelated. Active lifecycle proof (compression,
append, lookup, replay, no-op and conflict preservation) completed in 282 ms for a
synthetic 4.8 MB evidence fixture on the local machine; this is not a production
latency guarantee. Current/future threshold proof also passed. Existing schema and
byte/hash verification remain unchanged. Parent review complete; final PR owns
exact-head CI and ReviewGPT. No deployment or private vault mutation.
Status: completed
Updated: 2026-09-21
Completed: 2026-09-21
