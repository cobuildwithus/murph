# Land browser-vault metric sample hard-cut patch

Status: active
Created: 2026-05-03
Updated: 2026-05-03

## Goal

- Land the supplied Patch 3/4/5 intent so browser-vault current biomarker values come from metric selections, metric-selection ids are stable across metric/biomarker combinations, and canonical `metric_sample` rows are first-class in contracts/core/query.

## Success criteria

- Patch intent is applied without overwriting unrelated worktree edits.
- Browser-vault query selection lookups distinguish metric keys from biomarker keys and prefer the catalog biomarker selection for `get(metricKey)`.
- Query/core/contracts recognize the dedicated `metric_sample` ledger family and extract display-grade `MetricPoint` rows from manual/normalized/derived metric samples.
- Biomarker private trend UI uses `metricSelections` for current/latest values while charts remain series-backed.
- Focused tests, typecheck/verification, and required completion audits are run or any blockers are documented.

## Scope

- In scope:
- `packages/contracts`, `packages/core`, and `packages/query` changes needed by the supplied patch.
- The directly coupled biomarker private trend card UI/test surface.
- Focused test additions or repairs needed for the patch behavior.
- Out of scope:
- Patch 1/2 behavior already present in the current tree.
- Unrelated hosted onboarding/app-session rows and unrelated dirty edits in homepage hero/background and heartbeat button components.
- Broad metric storage redesign beyond the dedicated `metric_sample` hard-cut.

## Constraints

- Technical constraints:
- Preserve package boundaries and import via public entrypoints.
- Do not use broad fallbacks that silently emit selections for every observed private metric.
- Keep raw device/import metric samples out of display `MetricPoint` expansion unless intentionally normalized/manual/derived.
- Product/process constraints:
- Follow the high-risk repo workflow: ledger, plan, required audits, verification, and scoped commit.
- Do not expose personal identifiers, secrets, raw health payloads, or local absolute paths in generated artifacts or handoff.

## Risks and mitigations

1. Risk: The supplied patch has stale or malformed hunk metadata.
   Mitigation: Use `git apply --recount --3way` for clean hunks and manually reconcile only the failing file against current source.
2. Risk: New `metric_sample` rows widen persisted canonical health-data behavior.
   Mitigation: Keep the new family under contract/core/query tests and run security/privacy review.
3. Risk: UI current values could regress by reading chart series instead of selections.
   Mitigation: Keep the panel selection/current split explicit and run focused web/query tests.

## Tasks

1. Register plan/ledger and inspect patch/worktree state.
2. Apply clean patch hunks and manually reconcile stale `vault-source.ts` changes.
3. Review resulting diff for privacy, scope, type, and test gaps.
4. Run focused verification and required completion audits.
5. Address findings, rerun affected checks, close plan, and commit scoped changes.

## Decisions

- Treat the supplied diff as behavioral intent rather than overwrite authority.
- Use a plan despite the patch landing because the scope crosses schema/storage, query, core, and UI behavior.

## Verification

- Commands to run:
- `pnpm --filter @murphai/contracts verify`
- Focused query/web/contracts tests named in the patch handoff where available.
- `pnpm typecheck`
- Broader acceptance or truthful scoped fallback per verification docs depending on current dirty-tree blockers.
- Expected outcomes: relevant tests and typecheck pass, or unrelated pre-existing failures are named with enough detail to distinguish them from this diff.
