# Harden Garmin historical recovery after PR review

Status: completed
Created: 2026-07-09
Updated: 2026-07-10

## Goal

- Preserve resource-aware Garmin history recovery while removing the
  support-gated Junction mutation and making the remaining self-service path
  safe under mixed runner versions.

## Success criteria

- No default-disabled Junction API is part of the recovery path.
- Old runners cannot convert current resource-aware progress into trusted
  account-level completion.
- Missing Garmin history gets bounded observation retries, then a precise
  self-service disconnect-and-reconnect signal through existing source-health
  surfaces; current data ingestion remains active.
- Authenticated late Garmin history can satisfy the exact missing
  source/resource obligations even when Junction REST remains stale.
- Disconnect and historical progress remain monotonic across hosted/local
  hydration and mixed runner versions.
- The stale hosted-metadata cap assertion is corrected and CI is green.

## Scope

- Junction historical status encoding, source-health projection, hosted
  reconnect guidance, focused regressions, matching docs, and PR verification.
- No new service, queue, retry owner, broad egress handler, automatic provider
  deregistration, or frontend architecture.

## Decisions

- Delete `bulk_trigger_historical_pull`: Junction documents it as a Link
  Migration capability disabled by default, and a new hosted mutation would
  also require a complete Worker-owned credential boundary.
- Encode the policy version in the existing status scalar. A legacy writer can
  overwrite it only with a legacy value, which current code reopens safely.
- Use the existing per-source health record for the exact provider that still
  lacks history. Keep ingestion active until the member explicitly confirms the
  existing connection-wide disconnect, whose scope may include other Junction
  sources, and then reconnects Garmin.
- Persist authenticated canonical late arrivals in one bounded, versioned,
  window-scoped source/resource scalar. Union it with fresh REST coverage in
  the existing exact-window job; do not add a queue, table, or vault read seam.
- Advance the source ordering timestamp on disconnect so a warm runner cannot
  publish stale connected/error state over a hosted terminal snapshot.
- Ignore providers outside the configured Junction filter when evaluating
  coverage obligations.
- Treat only advertised activity, sleep, and sleep-cycle families as absence
  obligations. Junction availability is capability metadata, so sparse
  workouts and body measurements cannot create false reconnect alarms.
- Hydrate persisted connection-source rows into the hosted runner before jobs
  execute. This keeps the control plane as the source of truth and lets an
  entirely empty provider response retain the member's requested source without
  adding provider-specific retry metadata.
- Project exhausted historical recovery as a semantic connection reset in the
  browser surface. Suppress connect-only reconnect, require the existing
  account-scoped confirmation, then expose the ordinary Connect action.
- Persist a semantic warning when provider-side reset fails and tell the member
  to remove the provider connection manually before reconnecting; local
  disconnect remains authoritative.
- Derive the unfinished-reset browser semantic at the server response boundary,
  so a shared connection shows the same recovery guidance regardless of which
  sibling source initiated the account-scoped disconnect.
- Clear a persisted revoke warning in the same transaction that successfully
  removes the retained provider credential on retry, without emitting another
  disconnect signal, mailbox item, or wake.
- Treat an accepted `connectedAt` change as a new connection epoch. Do not merge
  prior unpublished historical progress or evidence into that epoch, even when
  UTC day-flooring produces the same historical window.

## Verification

- Device-sync coverage: 40 files, 752 tests; 89.04% statements and 79.70%
  branches. Device-sync typecheck passed.
- Assistant-runtime: 70 files, 1,497 passed and 2 skipped. Assistant-runtime
  typecheck passed.
- Focused web recovery surface: 4 files, 151 tests. Web typecheck passed.
- Security/privacy audit found no medium-or-higher issue. Frontend and
  simplicity reviews found three concrete state/copy edge cases; all are fixed
  with focused regressions and the final reviews report no remaining material
  findings.
- Diff/privacy checks passed, including absence of incident identifiers, local
  paths and identities, personal contact data, credentials, and the unsupported
  Junction client mutation.
- The affected-workspace gate passed: 14 dependent package typechecks and
  tests, the hosted-local package boundary, the full web verification (4,046
  tests), and the Cloudflare verification (1,679 tests).
- PR ReviewGPT and final CI remain after the scoped commit/rebase/push.
Completed: 2026-07-10
