# Speed up game history reads

Status: active
Created: 2026-11-01
Updated: 2026-11-01

## Outcome and invariants

Reduce Games history wait while preserving identical JSON, ordering, blocks,
reports, rollout gates, and fresh media authorization. Web game service owns
reads; existing media delivery owns signing. No new caches, tables or jobs.

## Investigation and approach

Measure synthetic local PostgreSQL history with several opponents and rounds,
including native auth, candidate selection, loading, database clock, hydration,
projection, and signing. Count actual driver round trips and crypto fields.
Separate local provider substitutes from production latency evidence. Investigate
repeated photo authorization and unused history decryption before implementation.
Prefer removing unused work and batching existing reads at their current owner.

## Product UX

Patch: an authenticated member opens Games and sees the same history sooner.
Replay empty and populated history, both viewers, blocked/reported/withdrawn
content, repeated media keys, outsider access, and signing failures. No UI change.

## Verification and delivery

1. Capture before timings and response fixtures.
2. Apply the smallest measured correction and prove payload equivalence.
3. Run focused PostgreSQL, route, view tests, Web typecheck, lint, complexity.
4. Review diff and add changelog; push draft PR with timing evidence.
5. Mark ready and start ReviewGPT concurrently with exact-head CI; respect
   other sessions' packaging and browser lanes. Verify and disposition findings.
6. Merge after required gates; verify deployed revision and bounded aggregate
   Vercel request timings. No member data reads or production writes.

## Risks

Fresh media checks must survive mutations after history assembly. Preserve
single-key authorization semantics, including canonical profile photos and
reused keys. Signing remains bounded and falls back to stable URLs on failure.
No schema or runtime protocol changes are intended; Web deploys independently.

## Evidence

Synthetic loopback PostgreSQL fixture: four opponents, three settled games each,
72 previews, 24 latest-card delivery keys. Ten warm samples after one warmup;
real native auth, encryption, root rows and local KMS provider. Signing returns
synthetic capabilities. Temporary performance spans isolate private service
steps; driver timing counts actual SQL round trips. Spans are removed from code.

| Step | Before median ms | After median ms |
| --- | ---: | ---: |
| Auth | 6.28 | 4.99 |
| Candidate query | 0.95 | 1.20 |
| loadHistoryGames | 1.40 | 2.14 |
| databaseNow (parallel with load) | 0.31 | 0.39 |
| buildViewInputs, including real decryption | 3.20 | 2.75 |
| buildGameHistoryView projection | 0.27 | 0.25 |
| withHistoryPhotoDeliveries (local signer substitute) | 7.39 | 5.77 |
| Entire composed read | 20.62 | 17.83 |

SQL: 52 → 18 (auth 7 → 5, history 9 → 9, signing 36 → 4).
KMS unwraps: 8 → 5. Non-null game fields decrypted: 17 → 4.
Provider-latency sensitivity replay (53 ms per KMS call, 128 ms per signing call): 1087.60 → 679.52 ms. This is a simulation using observed production medians, not a live latency result.

Baseline production aggregate recheck: 53 hot invocations; p50 1,476 ms,
p90 3,243 ms over the 48-hour query window. The supplied request-log baseline
was p50 1,450 ms and p90 2,000 ms; retain this distinction rather than treating
separate aggregate methods as identical. Provider aggregates: 318 Worker calls
(p50 128 ms, p90 905 ms), 269 KMS calls (p50 53 ms, p90 122 ms).
No member data, request payloads or identifiers were inspected.

Original-versus-candidate differential run passed all 49 existing service
scenarios, checking full history JSON and media authorization results. Retained
regressions cover unused-field decryption, SQL/unwrap counts through real crypto,
route scope cleanup and next-request revocation, post-assembly reports/blocks,
maximum-size signing concurrency and own-image fallback on database failure.

Focused checks: 272 game/auth/crypto tests plus four changelog rendering tests;
Web typecheck, scoped Oxlint and complexity guard pass (no hotspots above 20).
Final review, exact-head CI, merge and live follow-up remain delivery gates.


## Reproduce focused proof

Use an isolated loopback `murph_test`-prefixed database with deployed migrations.
Run the existing service test with `MURPH_TEST_POSTGRES_CONCURRENCY=1`.
Set `MURPH_GAME_HISTORY_BENCH=1` and select `-t 'bounds populated'` for ten
warm samples in `.tmp/game-history-speed/benchmark.json`;
`MURPH_GAME_HISTORY_BENCH_LATENCY=1` adds the explicitly modeled provider delays.
Normal CI runs the same fixture without delays and asserts SQL/unwrap counts.
The per-step table used temporary spans around the four private service helpers;
no production logging or timing hooks are added.
