# Land browser-vault metric sample hard-cut patch

Status: completed
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

1. Done: Register plan/ledger and inspect patch/worktree state.
2. Done: Apply clean patch hunks and manually reconcile stale `vault-source.ts` changes.
3. Done: Review resulting diff for privacy, scope, type, and test gaps.
4. Done: Run focused verification and required completion audits.
5. Done: Address findings, rerun affected checks, close plan, and commit scoped changes.

## Decisions

- Treat the supplied diff as behavioral intent rather than overwrite authority.
- Use a plan despite the patch landing because the scope crosses schema/storage, query, core, and UI behavior.
- Keep biomarker panel current/latest values selection-backed only. Trend rows without a current metric selection return `missing_selection` so the UI does not show the device-connect CTA for already-present chart data.
- Apply the same display-grade metric-sample predicate to metric points, browser-vault sample entities, daily summaries, and sample windows. Raw device/import `metric_sample` rows stay out of generic browser-vault surfaces unless they are normalized/derived/manual.

## Verification

- Passed: `pnpm --dir packages/query exec vitest run --config vitest.config.ts test/browser-vault-biomarker-panel.test.ts test/browser-vault-metric-points.test.ts test/browser-vault-replica-coverage.test.ts test/browser-vault-metric-points-labs-measurements.test.ts`
- Passed: `pnpm --dir packages/query exec vitest run --config vitest.config.ts test/query.test.ts -t "summarizeDailySamples|summarizeSampleWindow"`
- Passed: `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts test/biomarker-private-trend-card.test.ts`
- Passed: `pnpm --dir packages/contracts exec vitest run --config vitest.config.ts test/schema-catalog-examples.test.ts test/vault-layout-validation.test.ts`
- Passed: `pnpm --filter @murphai/contracts verify`
- Passed: `pnpm --dir packages/query typecheck`
- Passed: `pnpm --dir packages/query test:coverage`
- Passed: `pnpm --dir packages/core test:coverage`
- Passed: `pnpm test:smoke`
- Passed: `git diff --check`
- Passed: diff privacy scan over changed hunks for personal identifiers/secrets.
- Blocked by unrelated pre-existing issue: `pnpm typecheck` fails in `apps/web/app/design/components-content.tsx` because design examples pass `onSuccess` to `HeartbeatButtonProps`, which no longer exposes that prop.
- Blocked by unrelated pre-existing issue: `bash scripts/workspace-verify.sh test:diff <changed paths>` fails in `packages/cli/test/release-script-coverage-audit.test.ts` because `agent-docs/exec-plans/active/2026-05-03-localhost-hosted-auth-redirect.md` has no matching coordination-ledger row. The lane completed static guards, package typechecks including `packages/query`, and several affected package test suites before that blocker.

## Audits

- Security/privacy review found raw device/import `metric_sample` rows still leaking through generic browser-vault sample entities/summaries; fixed by filtering those generic projections with the display-grade predicate and rerunning focused/package checks.
- Frontend review found trend-only rows and true no-data collapsed into the same connect-device empty state; fixed with `missing_selection` and focused UI/query tests.
- Coverage-write worker reviewed the proof and made no changes; existing focused tests and package coverage were sufficient.
- Final task-finish review returned no findings.
Completed: 2026-05-03
