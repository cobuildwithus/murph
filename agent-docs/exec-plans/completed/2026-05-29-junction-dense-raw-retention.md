# Junction dense raw retention hardening

Status: completed
Created: 2026-05-29
Updated: 2026-05-29

## Goal

- Make Junction dense raw timeseries retention real enough to rely on: old dense
  raw artifacts should be tombstonable by the automatic/operator maintenance
  path, and current dense Junction defaults such as distance and active calories
  must be classified as dense raw when retention is applied.

## Success criteria

- Dense raw pruning can be invoked by a repo-owned operational path with
  `pruneDenseRaw: true` and `includeRecentDenseRaw: false`.
- Dense classifier covers at least heart rate, distance, and active calories
  Junction timeseries roles without classifying sparse product facts.
- Focused tests prove old dense raw artifacts are tombstoned, recent dense raw
  artifacts are preserved, pruning remains opt-in, and product/summary raw
  artifacts are untouched.
- Operational result/log surface reports candidate counts and bytes
  before/after/freed/skipped without payload details.

## Scope

- In scope:
  - `packages/core` dense raw role classification and migration tests.
  - Existing CLI/usecase operational repair surface plus the hosted
    device-sync maintenance hook as the automatic pruning path.
  - Hosted runtime log event-code contract needed for the new metadata-only
    retention log.
  - CLI/usecase result-surface tests for the new dense raw byte metrics.
  - Durable docs only if the runtime/architecture boundary changes.
- Out of scope:
  - Query/read visibility changes.
  - Raw timeseries normalization into canonical events or samples.
  - Provider fetch/window changes in already-active Junction provider files.
  - Hosted cron or broad scheduling infrastructure unless already present.

## Constraints

- Technical constraints:
  - Preserve explicit raw repair proof: manifest byte/SHA checks, tombstones, and
    metadata-only audit records.
  - Do not hard-delete raw artifacts.
  - Do not log provider payloads, health rows, account ids, local paths, or
    identifiers.
- Product/process constraints:
  - Keep dense telemetry as raw evidence/debug material only.
  - Preserve unrelated dirty work in active Junction/device-sync lanes.

## Risks and mitigations

1. Risk: Automatic pruning could remove sparse or product-relevant evidence.
   Mitigation: Keep classifier role-based, focused on known dense resources,
   and test summary/product artifact preservation.
2. Risk: Operational logs expose health payload detail.
   Mitigation: Surface only counts and byte totals already returned by the
   migration result.

## Tasks

1. Inspect current classifier, repair usecase, and operational command surfaces.
2. Expand dense raw classifier coverage for Junction distance and active
   calories role variants.
3. Add or adjust the narrow operational invocation/logging surface for dense
   pruning.
4. Add focused migration/usecase/CLI tests for retention behavior and metrics.
5. Run required verification/audit workflow and finish with a scoped commit.

## Decisions

- Use the existing hosted device-sync maintenance path for automatic pruning so
  the change does not add a cron/table/queue or touch active provider sync work.

## Verification

- Passed:
  - Focused core/usecase/CLI/assistant-runtime/hosted-execution tests and
    coverage checks for wearable storage repair and hosted retention behavior.
  - Focused package typechecks for touched package boundaries.
  - Scoped `git diff --check`.
  - Scoped sensitive hunk scan.
  - `bash scripts/workspace-verify.sh test:diff ...`.
- Expected outcomes:
  - Tests pass and retention behavior is covered without raw payload exposure.
Completed: 2026-05-29
