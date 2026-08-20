# Database Health Required-Metric Confirmation

## Goal

Prevent a single transient omission of one otherwise-required PlanetScale
metric family from advancing the database monitor's consecutive-failure state,
without treating unknown telemetry as zero or delaying concrete unsafe-signal
evaluation.

## Constraints

- Keep the existing independent Cloudflare Durable Object owner and bounded
  provider-call budget.
- Preserve immediate evaluation and paging for every available unsafe signal.
- Preserve the two-consecutive-check warning for a confirmed or persistent
  telemetry gap.
- Do not persist or log raw provider payloads, signed scrape parameters, metric
  labels, or secrets.
- Prefer the smallest change in the existing collection/confirmation flow.

## Plan

1. Ask ReviewGPT to implement a scoped patch and focused regression coverage.
2. Inspect the returned artifact as untrusted intent and apply only the bounded
   monitor/test changes that satisfy the repository invariants.
3. Run the focused Cloudflare Node and Workers-runtime database-health tests,
   package typecheck, and diff checks.
4. Commit and push an exact candidate, open a draft PR, and run the required
   coverage specialist and final cross-cutting ReviewGPT gates with CI.
5. Resolve accepted findings, perform the parent final review, prove current-base
   mergeability, and record the Cloudflare-only deployment contract.

## Verification

- A safe first scrape missing one required family receives one bounded
  confirmation.
- Recovery on confirmation produces a complete sample and does not advance the
  consecutive-failure counter.
- Persistent absence remains incomplete and still warns after two consecutive
  scheduled checks.
- Unsafe evidence from the first or confirmation scrape still pages immediately
  and is not erased by recovered telemetry.
- Provider requests remain bounded below the run lease and platform runtime.

## Changelog Decision

Not applicable: this changes internal operator-monitor collection behavior and
does not create a member-visible product outcome.

