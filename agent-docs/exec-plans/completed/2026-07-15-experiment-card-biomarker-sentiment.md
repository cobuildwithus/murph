Goal (incl. success criteria):
- Make experiment progress cards interpret biomarker movement from the canonical Health Commons desired direction instead of the experiment-specific hypothesis.
- Fix HRV increases so they render as favorable, preserve favorable decreases for lower-is-better biomarkers, and keep stable, contextual, unknown, and unchanged signals neutral.
- Canonicalize supported biomarker aliases such as `biomarker:hrv` to the same direction metadata as `biomarker:hrv-rmssd`.
- Success means the encoded card remains an immutable validated snapshot, focused regression tests prove contradictory-hypothesis HRV behavior plus every desired-direction class, and relevant typecheck/test/coverage gates pass.

Constraints/Assumptions:
- Keep experiment `expectedDirection` and `movedAsExpected` semantics unchanged for hypothesis analysis; only card sentiment changes.
- Health Commons remains the source of truth for biomarker desired-direction metadata; health-metrics remains neutral.
- Do not add persisted state, a compatibility shim, or a payload version bump because the payload shape and renderer layout stay unchanged.
- Preserve unrelated working-tree and coordination-ledger work.

Key decisions:
- Snapshot the canonical sentiment while generating the URL payload so a previously generated card cannot change when catalog metadata changes.
- Treat `higher` / `higher_or_stable` upward changes and `lower` / `lower_or_stable` downward changes as favorable; treat the inverse as unfavorable.
- Treat `stable`, `mixed_or_contextual`, missing metadata, and zero movement as neutral because direction alone is insufficient to judge them.
- Resolve canonical aliases through the existing metric registry before consulting Health Commons metadata.

State:
- Complete; verified and ready for scoped commit.

Done:
- Traced the card producer, payload contract, renderer, experiment-analysis direction semantics, interactive experiment-result semantics, generated Health Commons biomarker metadata, and relevant history.
- Proved the root mismatch: the producer maps `movedAsExpected` to visual sentiment, while the interactive results surface maps canonical biomarker desired direction to sentiment.
- Identified the adjacent HRV alias gap and missing card-level coverage for upward HRV, neutral/contextual biomarkers, and contradictory experiment hypotheses.
- Added a shared pure direction-to-sentiment classifier covering every Health Commons desired-direction class.
- Injected canonical Health Commons desired-direction snapshots at the vault-usecase composition boundary so query remains browser-safe and generated cards remain immutable.
- Canonicalized legacy biomarker aliases for desired-direction lookup and experiment expectation lookup, deduplicated semantic primary/secondary aliases, and cleared a stale legacy primary direction when the primary biomarker changes.
- Reused the shared classifier in the browser experiment-results surface and made partial progress-card signals neutral.
- Added focused regressions for contrary-hypothesis HRV increases, lower-is-better RHR, every desired-direction class, legacy HRV aliases, stale edit state, and the composed vault-usecase card path.
- Coverage-write added semantic alias deduplication, alias-aware expectation replacement, and direct progress-card route color proof; all focused suites passed.
- Frontend-review passed with no findings and confirmed that a live browser pass is unnecessary because no layout or rendering code changed and the deterministic route test covers the visual color contract.
- Full changed-package verification passed: contracts (178 tests plus schema artifacts), Health Commons (71 tests plus typecheck and generated-artifact drift), query (498 tests plus typecheck), vault-usecases (196 tests plus typecheck), and web (5,219 tests plus TypeScript, lint, dev smoke, and production build).
- Dependency policy, workspace boundaries, docs drift, ignored-build review, and diff hygiene passed. The registry audit endpoint returned HTTP 410; no third-party dependency changed.
- Truthful root `test:diff` reached the unrelated CLI release-smoke lane with 368 tests passing, then a release-manifest subprocess timed out under severe shared-host load. A focused retry hit the test runner's own timeout under the same load; all changed-package lanes subsequently passed sequentially and PR CI remains the repository-wide gate.

Now:
- Close the plan and create the scoped commit.

Next:
- Open the PR and run ReviewGPT concurrently with CI through a clean result.

Open questions (UNCONFIRMED if needed):
- None that block implementation.

Working set (files/ids/commands):
- packages/health-commons/src/runtime.ts
- packages/health-commons/test/runtime.test.ts
- packages/health-commons/tsconfig.json
- packages/query/src/biomarker-change-sentiment.ts
- packages/query/src/browser-experiments.ts
- packages/query/src/experiment-progress-card.ts
- packages/query/src/experiments.ts
- packages/query/src/index.ts
- packages/query/test/biomarker-change-sentiment.test.ts
- packages/query/test/experiment-analysis.test.ts
- packages/vault-usecases/package.json
- packages/vault-usecases/src/usecases/experiment-journal-vault.ts
- packages/vault-usecases/test/experiment-onboarding-schedule.test.ts
- packages/vault-usecases/test/experiment-progress-metric-projection.test.ts
- packages/vault-usecases/vitest.config.ts
- apps/web/src/lib/health-commons/biomarker-desired-direction.ts
- apps/web/src/lib/browser-vault/experiment-run.ts
- apps/web/test/biomarker-desired-direction.test.ts
- apps/web/test/connect-source-and-experiment-card-routes.test.tsx
- packages/contracts/src/experiment-progress-card.ts
- ARCHITECTURE.md
- pnpm-lock.yaml
- pnpm --dir packages/health-commons verify
- pnpm test:diff <touched paths>
Status: completed
Updated: 2026-07-15
Completed: 2026-07-15
