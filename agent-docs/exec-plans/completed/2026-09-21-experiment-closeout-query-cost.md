# Keep experiment closeout off the global query rebuild path

Status: completed
Created: 2026-09-21
Updated: 2026-09-21

## Outcome

Remove global query-cache rebuilding from automatic experiment outcome persistence while preserving current evidence, metric selection, locking, and retry semantics. A hosted warm-wake investigation exposed this synchronous maintenance path; existing telemetry cannot conclusively attribute the observed stall to it.

## Reaches

The shared vault usecase serves managed lifecycle maintenance and explicit outcome analysis/writes. Reuse the canonical experiment analysis source already used by progress. Do not change runtime wake retries, delivery, scheduling, or production state.

## Proof

- Reproduce that outcome analysis and persistence create the global query database.
- Assert analysis, first persistence, and stable replay use current canonical evidence without creating that database.
- Preserve metric windows, anchors, adherence, concurrent session serialization, and conflict retries in existing tests.
- Run focused usecase tests, owner typecheck, diff complexity, and candidate review.
- Production latency improvement remains unverified until a reviewed release and a new trace.

## Product journeys

- A completed run saves the same outcome without building unrelated search state.
- A concurrent session is included under the existing canonical lock.
- A replay returns the linked result without recomputation or unrelated cache work.

## Decisions

- Reuse the existing query source instead of adding a worker, scheduler, or cache.
- Keep incident-specific data out of durable artifacts.

## Verification

- The added no-query-database regression failed on the original implementation and passed after the change.
- Focused metric, anchor, adherence, replay, and outcome concurrency suite: 14 passing tests.
- `pnpm typecheck`: passed across the workspace.
- `pnpm --dir packages/vault-usecases test:coverage`: passed, 50 files and 486 tests; coverage thresholds passed after updating the service mock for the new canonical read seam.
- Changelog rendering: 10 passing tests using the repository-root Vitest invocation. The documented app-relative command discovers no tests; existing Frog entries already cover that issue.
- `pnpm complexity:diff`: passed; debt unchanged. Existing hotspots are unrelated to the edited functions.
- A synthetic 20,000-observation read measured 714 ms for global query hydration versus 458 ms for canonical analysis, with maximum timer gaps of 372 ms and 323 ms. This single local run is diagnostic evidence, not a production latency guarantee; filesystem and runtime caches were warm for the second read.
- Product UX: Ready for the narrow experiment-closeout change. Hold on claiming the reported warm-wake incident resolved: exact production attribution and post-release latency remain unverified.
- No production mutations, PR, or deployment were performed. Final ReviewGPT is a pushed-PR gate and does not apply to this local-only candidate.

Completed: 2026-09-21
