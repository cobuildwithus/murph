# Junction importer complexity

## Outcome and scope

Reduce branching in daily aggregation and sparse interval parsing without changing
provider normalization, canonical facts, evidence, or errors. Source owner remains
`packages/importers/src/device-providers/junction.ts`; no new abstraction or state
owner. Baseline: `b6454467652310f7abdd63676dab0f769c340ae8`.

## Protected behavior

Preserve record selection and ordering, floating-point accumulation order, signed
zero handling, timestamp and alias precedence, source authority, legacy day keys,
all response/source-day/output caps, and atomic rejection of incomplete days.
No UI, policy, health-model, database, or deployment contract changes.

## Steps and evidence

- [x] Inspect current owners, Frog entries, caller flow, and exact-path open PR overlap (none).
- [x] Prove both temporal resources admit 25,000 rows across source instances and reject 25,001 before accumulation.
- [x] Delete only unreachable import-counter state, simplify repeated diagnostics and terminal temporal branches, and remove sparse predicates excluded by prior returns.
- [x] Run public-normalizer baseline/head proof, focused Junction suites, importer typecheck, and complexity comparison.
- [ ] Inspect complete diff/privacy, archive with scoped commit, open draft PR, and obtain parent candidate review.
- [ ] Run exact-head ReviewGPT concurrently with CI and report results; keep PR open.

## Reasoning and risks

`buildJunctionDailyTimeseriesAggregates` has one row loop and two internal callers;
all calls pass the same pre-loop fidelity response bound. Both temporal resources
use the dense 25,000-row policy, while the removed counter can increment only once
per entry. Its greater-than-25,000 branch is unreachable. Preserve independent
per-source-day, per-vault-day, and temporal output limits. Sparse instant/interval
body branches return before generic interval handling; generic inputs always need
start/end, and only three resource types permit an omitted timestamp.

The main risk is changing subtle numeric or timestamp behavior during control-flow
cleanup. Do not replace ordered arithmetic or daily min/max comparisons with
shared initialization or Math helpers. Existing canonical replay and error tests
plus direct boundary tests own behavioral proof. No new Frog entry is warranted
by the routine clean worktree setup.

## Completion evidence

- Five focused Junction importer suites pass: 288 tests covering canonical replay,
  source authority, bounded features, activity and companion metadata, sparse
  parsing, and the two new 25,000/25,001 cross-source response boundaries.
- `pnpm --dir packages/importers typecheck`: pass.
- `pnpm complexity:diff --base b6454467652310f7abdd63676dab0f769c340ae8 -- packages/importers/src/device-providers/junction.ts`: pass; file debt 174 to 153,
  daily aggregation 106 to 98.
- An ignored synthetic public-normalizer harness captured 350 cases against the
  base and candidate; serialized outputs and errors match byte for byte, including
  explicit signed-zero preservation. It covers sparse/body timestamp rules,
  malformed values, source-day errors, ordering, duplicate records, and timezones.
- Temporal resources are exactly blood oxygen and stress level; both use the dense
  25,000 response policy, matching the removed counter limit. Admission precedes
  the single row loop. Independent per-source-day and output caps remain intact.
- Parent candidate review accepted the source shape. Diff/privacy readback passes;
  existing Frog inventory reviewed, no new qualifying repository friction.

Local implementation is complete. Draft PR, final ReviewGPT and required exact-head
CI remain external gates. No merge is authorized. No changelog or Product UX work
is required because this preserves existing member-visible behavior.
Status: completed
Updated: 2026-09-04
Completed: 2026-09-04
