# Import neutral health metrics from their owning package

Status: active
Created: 2026-09-10
Updated: 2026-09-10

## Goal and protected invariant

CLI sample/wearable queries and private lab displays consume neutral metric
primitives directly from `@murphai/health-metrics`. Preserve their existing
numeric results, unit handling, fallback precedence, and source-range authority.

## Evidence and ownership

The importer sample-summary and metric-catalog modules and the Health Commons
biomarker fallback module only re-export health-metrics. Current CLI and Web
consumers already declare the true owner. Importers also re-exports sample
summary functions and types through its root and CSV facade; those are obsolete
public aliases. Source aliases in root/Web TypeScript configuration preserve the
same unnecessary routes.

## Scope and approach

1. Switch all live consumers, including importer planners and integration tests,
   to the existing health-metrics root export.
2. Delete the three pass-through files, their manifest exports and TypeScript
   aliases, and the importer root/CSV sample-summary re-exports.
3. Preserve the focused runtime regressions and tighten existing package boundary
   guards so the retired routes cannot return.
4. Correct durable ownership documentation and run focused tests, affected
   typechecks, workspace cycle/boundary guards, and complexity review.

No new dependency, abstraction, state, runtime policy, numeric catalog entry,
network call, or persistence transition is introduced. Packages are
workspace-private and all current consumers move together; there is no current
consumer requiring a compatibility shim. Failure, retry, and deployment behavior
remain unchanged because the same runtime symbols execute.

## Product UX and changelog

Internal package ownership only: sample queries, wearable queries, and private
lab fallback rendering retain their existing output. No changelog entry or new
rendering proof is needed for import-only rewiring and type import changes.

## Verification

Passed focused verification:

- Health metrics: sample-summary, wearable-catalog, and lab-range tests (10).
- Importers: package boundary, CSV import/profile, and wearable evidence tests (46).
- CLI: sample-helper, wearable schema, and additive-command tests (21); final
  consolidated wearable imports reran the additive-command tests (7).
- Health Commons authored/runtime range parity and literal retired export test
  (6), with a 180-second runner hook allowance; the final hook took 42 seconds.
- Web composed lab fallback-context tests (2), after generated artifacts existed.
- Importers, health-metrics, Health Commons, CLI, and Web typechecks; Web used
  the standard generated artifacts and Prisma client preparation.
- Workspace dependency-cycle and source-boundary guards, syntax validation for
  the changed boundary script, and authored-content privacy scan.
- Complexity diff passed: the unchanged chart-range resolver remains at 22;
  import rewiring creates no additional decisions or complexity debt.

Initial focused Web invocation used the wrong root and then preceded generation;
rerunning from the repository root after generation passed. The Health Commons
content hook intermittently exceeded its default 60-second timeout under local
content-read contention. The final run passed with a runner-only 180-second
hook allowance; no repository or production timeout changed.

Documentation drift and gardening checks passed with zero gardening issues.
The independent final consumer audit found no remaining shim imports, aliases,
barrel leaks, or unrelated edits.

## Pending completion gates

The completion owner handles the scoped commit, PR creation, final ReviewGPT,
exact-head CI, mergeability proof, and final plan closure. Keep this plan active
until those gates finish. No merge or deployment is part of this task.
