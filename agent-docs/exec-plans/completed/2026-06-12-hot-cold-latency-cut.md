# Hot/Cold Path Latency Cut (msg → provider start)

Goal: cut hosted Linq/iMessage message→provider-start latency by ≥25% on both the
warm (hot) path and the cold path, with minimal-complexity changes only.

## Measured baseline (prod traces, 2026-06-10..12, source=linq)

Cold p50 ~11.5s: accept→temporal ~0.9s · temporal→runner-job ~5–8s (≈2.0s
temporal hop + DO prep, ≈4.3s CF container schedule + node boot, nodeStartupMs
≈2.0s of it) · restore ~2.7s (sequential: unwrap ~1.0s → presign ~0.05s → fetch
~1.0s → decrypt+extract) · import ~1s · import→provider ~2s.

Warm fresh-dispatch p50 ~4.2s, p90 ~7.9s: accept→temporal ~0.9s · temporal→DO
~1.5s · import ~1.2s · import→provider ~2s (only ~0.3–0.6s accounted by
admission/preProviderSetup phases).

## Planned changes (this PR)

1. Restore overlap: run snapshot data-key unwrap concurrently with
   scratch-prepare → presign-get → object-fetch in
   `apps/cloudflare/src/runtime-platform/workspace-snapshot-port.ts`
   (independent steps; keep per-step timings). Cold −0.6–1.0s.
2. esbuild-bundle the runner container entrypoint (extend PR #134's vault-cli
   pattern) so cold boot stops walking node_modules on lazily pulled image
   layers. Cold −1–1.5s (validated locally before/after).
3. Web ingress: stop serializing the best-effort accepted-latency-trace write
   ahead of the Temporal signal in
   `apps/web/src/lib/hosted-onboarding/webhook-service-wake.ts`. Both −50–150ms.
4. Warm import→provider gap: decompose locally via hosted-local e2e
   (active-turn-latency / runner-warm-reuse), then take the top measured item
   only if it has a minimal-complexity fix. Otherwise document findings.
5. Temporal worker activity concurrency default (2) revisit only if measurement
   shows queueing; config-level change.

## Verification

- hosted-local e2e before/after timings (cold boot nodeStartupMs, restore
  phases, warm-turn phase breakdown).
- Owner-scoped tests: apps/cloudflare (runner bundle contract + snapshot port),
  apps/web wake handoff tests, assistant-runtime restore tests.
- Deploy-smoke contract guards (bundle byte budget, import surface) stay green.

## Status

- [x] Prod trace baseline captured (cold p50 ~11.5s; warm p50 4.17s,
      p90 7.92s; fresh warm dispatches ~5.5-6s typical)
- [x] Local harness baseline (active-turn-latency e2e + entrypoint import bench)
- [x] Changes implemented (restore overlap + unwrap-failure download abort,
      queued info-log writes + invocation/fatal-path drains, ingress trace
      overlap, bundled entrypoint + env pins + deny-list)
- [x] Local harness after-measurements: bundled entry evaluates 27 chunk files
      vs 959 module files (903 under node_modules), native import 290ms→210ms
      (prod nodeStartupMs ~2s is layer-pull I/O-dominated, hence the larger
      expected prod delta); restore overlap pinned by a deadlock-style
      concurrency test; e2e op timeline shows the provider-start trace firing
      before a 636ms info log write completes (baseline: blocked behind a
      789ms write); e2e ×3 scenarios + docker smoke green.
- [x] Owner tests green (cloudflare 1372, runtime 852, engine 1251, web 8)
- Measured-vs-projected: the ≥25% cuts are PROJECTED from per-segment prod
  baselines (cold: ~0.6-1.0s restore + ~1.0-1.5s boot + ~0.3-0.6s log writes
  + ~0.1s ingress ≈ 17-28%; warm: ~0.4-0.8s ≈ 10-19% p50, more at p90 where
  log-write stalls dominate). Re-measure `hosted_ingress_latency_trace` after
  deploy; if warm p50 lands under 25%, the next levers are the provider
  pre-start residual (~1.4s unaccounted between import and provider start)
  and the temporal hop (~1.5s floor).
- Deferred with rationale: temporal activity-concurrency raise (no queueing
  evidence yet — verify schedule-to-start latency in Temporal UI first);
  deferring awaited inbox projection (audio transcripts consumed by turns).
Status: completed
Updated: 2026-06-12
Completed: 2026-06-12
