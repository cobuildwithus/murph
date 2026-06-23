Goal (incl. success criteria):
- Reproduce the oversized local query projection with deterministic fixture data.
- Slim `.runtime/projections/query.sqlite` by removing repeated rich metric-point JSON blobs from the query projection while preserving queryable scalar columns.
- Success means existing query/read paths still round-trip needed values, old projections rebuild, focused size tests show metric-point rows no longer store provenance/context-heavy blobs, and the existing wearable-summary compact codec remains intact.

Constraints/Assumptions:
- Query projection state is rebuildable local projection state, not canonical vault truth.
- Do not reduce canonical vault evidence, raw imports, or product-visible health facts.
- Prefer deletion/simplification over a new side store or compatibility layer.
- Preserve lexical search behavior unless direct evidence shows search documents are part of the same root cause and can be safely bounded.

Key decisions:
- Store compact metric-point supplemental JSON that contains only non-scalar metadata needed by runtime readers instead of the original rich `MetricPoint`.
- Reconstruct metric points from scalar columns plus compact supplemental metadata on read.
- Bump the SQLite projection user version so existing local query projections rebuild.
- Leave wearable summaries on the existing stored codec; it already compacts per-metric envelopes and has stale-projection rebuild coverage.

State:
- Implementation, verification, and required local audits complete; final commit pending.

Done:
- Read required repo routing, architecture, invariants, verification, completion, security, and query docs.
- Created isolated task worktree and branch from current `origin/main`.
- Added a deterministic rich-provider metric observation fixture that reproduced the old oversized `metric_point_json` behavior before the fix.
- Compact metric-point projection storage now drops bulky repeated provenance/source details while preserving scalar query columns and selected metadata.
- Added read-path reconstruction from scalar columns plus compact metadata, plus stale v11 projection rebuild coverage.
- Focused package query tests passed.
- Root `pnpm typecheck` passed after preparing ignored workspace build artifacts with `pnpm build:workspace:incremental`.
- Scoped `bash scripts/workspace-verify.sh test:diff <task files>` passed.
- `pnpm test:smoke` passed.
- `git diff --check -- <task files>` passed.
- Security/privacy audit returned no medium-or-higher findings.
- Coverage-write audit reran the scoped `test:diff` lane, made no changes, and found no meaningful proof gap.
- Deep-review audit returned no confirmed production-breaking bugs; residual risk is the manual metric context allowlist needing tests/versioning if future context keys become runtime-significant.

Now:
- Commit through `scripts/finish-task`.

Next:
- Push the branch, open a PR, and run the external PR review loop if available.

Open questions (UNCONFIRMED if needed):
- Whether entity/search stored payloads need a separate future slimming pass; not needed for this targeted metric-point fix.

Working set (files/ids/commands):
- `packages/query/src/projection/schema.ts`
- `packages/query/src/projection/metric-store.ts`
- `packages/query/src/projection/wearable-summary-stored-codec.ts`
- `packages/query/test/query.test.ts`
- `packages/query/test/browser-vault-metric-points-labs-measurements.test.ts`
Status: completed
Updated: 2026-06-21
Completed: 2026-06-21
