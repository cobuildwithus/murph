# Restore completed experiment daily trends

Status: completed
Created: 2026-07-21
Updated: 2026-07-21

## Outcome and invariant

- Completed experiment reports show the daily measurements that supported the saved result.
- The saved outcome remains the sole authority for historical averages, deltas, confidence, conclusions, protocol identity, and analysis windows.
- Later imports or repairs must not silently rewrite or contradict a completed result.

## Current owner and proven gap

- `packages/query` owns experiment analysis and browser experiment projections.
- `packages/contracts` owns the saved outcome schema; `packages/core` persists that exact artifact.
- Current saved outcomes retain window summaries but discard their daily series. The completed browser projection therefore builds biomarker results with an empty `points` array even when the vault contains every measured day.

## Smallest durable correction

1. Extend the versioned saved-outcome contract with a bounded immutable daily point snapshot for each metric.
2. Have experiment analysis derive that snapshot from the same selected points used for the saved window summaries.
3. Render saved points directly for new outcomes.
4. For legacy outcomes without snapshots, derive an in-replica snapshot from retained evidence under current browser, current canonical, or v1 selection semantics only when a candidate exactly reproduces every saved window count, rounded mean, and delta; otherwise keep the whole outcome aggregate-only. Remove this compatibility read after production inventory contains no referenced outcomes without point snapshots.

No new store, writer, service, queue, projection owner, or UI component is introduced.

## Failure and deployment behavior

- Malformed, oversized, or internally inconsistent point snapshots fail contract validation.
- Legacy live points never replace saved aggregates and are omitted on any mismatch.
- New readers remain compatible with v1 outcomes, but old readers reject v2 outcomes. Deploy Web first, then Cloudflare with immediate container rollout; once a v2 outcome is written, the old Web reader is no longer a safe rollback target for that workspace.

## Proof

- Contract tests cover bounded saved points and legacy compatibility.
- Query analysis tests prove saved points are deterministic and match the saved summaries.
- Browser projection tests prove new snapshots render daily points, matching legacy outcomes recover daily points, and mismatching legacy outcomes stay aggregate-only.
- The focused web report test proves the chart receives daily baseline and intervention series.
- Run the canonical diff verification, required coverage and frontend audits, direct scenario proof, parent final review, scoped commit, PR CI, and ReviewGPT loop.
Completed: 2026-07-21
