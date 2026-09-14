# Simplify typed experiment plan composition

Status: completed
Created: 2026-09-12
Updated: 2026-09-12

## Outcome and owner

Reduce the branching and repeated derivation in the CLI typed experiment-plan
adapter while preserving accepted flags, errors, payloads, and canonical effects.
`packages/cli/src/commands/experiment.ts` owns typed input composition;
contracts own validation and core/usecase services retain all experiment writes.
The inspected base is `486a6595e51bff2a6cfa64beb4ee1a953854a8b6`.
The assigned baseline is file debt 154 and maximum function complexity 95.

## Evidence and scope

`buildExperimentPlanPayloadFromTypedOptions` combines source admission, revision
checks, window derivation, signal defaults, onboarding/support projection, and
schema assembly. It repeatedly resolves the primary expected signal and forwards
individual fields to existing typed option owners. Simplify those repeated
operations with small private stage adapters where they clarify the data flow.
Keep this an internal refactor; no new command, schema, dependency, state owner,
public export, framework, protocol behavior, or product restriction is needed.
Only the source file and focused CLI regression tests are implementation scope.

## Protected behavior

- Explicit current argv, not config defaults, authorizes custom fallback.
- Protocol/revision/test-plan admission and validation error ordering are stable.
- Explicit options outrank protocol defaults; zero baseline days clears windows;
  undefined, empty arrays, false, and zero keep their existing meanings.
- Primary/secondary outcome selection, ordered deduplication, signal mapping,
  capture admission, logging omission, and bounded text remain unchanged.
- Start, dry-run, and edit hydration still route through existing canonical owners;
  failed admission does not write, and dry-run never commits a plan.

## Work and proof

1. Prepare an ignored implementation prompt; ReviewGPT implements the source and
   behavior tests and returns a relative-path patch attachment.
2. After the parent downloads and hands off the patch, audit scope and behavior,
   apply it, install frozen dependencies, and rerun Frog list before any workaround.
3. Run focused phase2 and experiment expansion tests with one or two workers,
   the CLI package typecheck, and the changed cyclomatic complexity guard.
4. Inspect the full source/test diff and privacy, record actual metrics and proof,
   then close this plan with the final scoped commit. The parent owns candidate
   review, PR readiness, ReviewGPT, CI completion, and merge.

Commands planned from the repository root:

```sh
MURPH_VITEST_MAX_WORKERS=1 pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/cli-expansion-experiment-journal-vault-phase2.test.ts packages/cli/test/cli-expansion-experiment-journal-vault.test.ts
MURPH_TSC_PACKAGE_MODE=single-threaded pnpm --dir packages/cli typecheck
pnpm complexity:diff --base 486a6595e51bff2a6cfa64beb4ee1a953854a8b6 -- packages/cli/src/commands/experiment.ts
```

## Implementation and verification results

ReviewGPT authored the applied source/test patch without local source redesign.
Private source-admission and analysis-default helpers preserve the original
validation sequence. Analysis defaults reuse the primary protocol signal by exact
key; existing onboarding/support owners receive the same typed option fields.
Runtime source changed by +156/-165 lines; focused tests by +124/-5 lines.

- Frozen default-store dependency install and Frog list passed.
- The first cold test run found an unavailable generated Health Commons catalog
  and a built-CLI preparation timeout. The canonical `pnpm health-commons:generate`
  preparation passed; both focused suites then passed all 49 tests in 195.65s.
- CLI package typecheck passed with one checker.
- Complexity guard passed: file debt 154 to 113, maximum 95 to 65, and typed
  builder 95 to 46. The remaining 65 hotspot is the existing edit command.
- Full source/test inspection, exact patch blob comparison, diff whitespace check,
  and privacy inspection passed. No new friction entry or dependency changes.

The implementation is complete; parent-owned candidate review, PR readiness,
final ReviewGPT, and exact-head CI remain separate completion gates.
No changelog is needed because this preserves existing member behavior.
No deployment coordination is needed because payload and protocol are unchanged.
Completed: 2026-09-12
