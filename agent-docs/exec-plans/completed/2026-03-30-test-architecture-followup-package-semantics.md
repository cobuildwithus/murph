# 2026-03-30 Test Architecture Follow-up Package Semantics

## Goal

- Keep the root `vitest.config.ts` as the curated repo acceptance lane while restoring package-local `test` scripts to mean "run this package's full suite" rather than "run the curated root subset".

## Scope

- `agent-docs/exec-plans/active/2026-03-30-test-architecture-followup-package-semantics.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `vitest.config.ts`
- `packages/{assistant-runtime,assistantd,cli,core,device-syncd,hosted-execution,importers,inboxd,parsers,query,runtime-state}/{package.json,vitest.config.ts}`
- `agent-docs/operations/verification-and-runtime.md`
- `agent-docs/references/testing-ci-map.md`

## Findings

- The root `vitest.config.ts` is present in the live tree and already restores the curated repo package lane, targeted root V8 coverage surface, and `testTimeout: 60_000`.
- The current semantics gap is package-local: multiple package `test` scripts still call the root `vitest.config.ts` with `--project ...`, so they inherit the curated repo subset instead of their package-local `include: ["test/**/*.test.ts"]` surface.
- That makes `pnpm --dir packages/<pkg> test` ambiguous and breaks the intended distinction between "full package-local test loop" and "curated repo acceptance lane".
- Docs should state this split explicitly so `pnpm test:packages` means the curated repo lane while package-local `test` scripts keep their full package-local meaning.

## Constraints

- Preserve the root curated repo package lane in `vitest.config.ts`; do not broaden it back to whole-package discovery.
- Keep `packages/web`, `apps/web`, and `apps/cloudflare` out of the root package lane.
- Preserve overlapping dirty work across package configs and docs.
- Run the required completion audits for this non-doc repo config/script change.

## Plan

1. Point package-local `test` scripts back at package-local `vitest.config.ts` files so those commands run full package suites again.
2. Keep the root `vitest.config.ts` as the curated repo lane and update docs to describe the repo-lane/package-lane boundary explicitly.
3. Run direct proof for both boundaries: package-local `test` on at least one affected package plus root `vitest list` checks that curated projects still exclude `assistantd/service.test.ts` and `cli/gateway-core.test.ts`.
4. Run `pnpm test:packages` and `pnpm test:coverage` as far as unrelated dirty-tree blockers allow, then finish the required audits and commit only the touched files.

## Verification

- Passed: repo-lane scope proof
  - `pnpm exec vitest list --config vitest.config.ts --project assistantd`
    - lists only `packages/assistantd/test/http.test.ts` and `packages/assistantd/test/assistant-core-boundary.test.ts`
  - `pnpm exec vitest list --config vitest.config.ts --project assistantd | rg 'service\\.test'`
    - no matches
  - `pnpm exec vitest list --config vitest.config.ts --project cli | rg 'gateway-core\\.test'`
    - no matches
  - `pnpm exec vitest list --config vitest.config.ts --project query | rg 'bank-registry-queries|foods|health-library|profile-snapshot-cutover'`
    - no matches
- Passed: package-local scope proof
  - `pnpm --dir packages/query exec vitest list --config vitest.config.ts --project query | rg 'bank-registry-queries|foods|health-library|profile-snapshot-cutover'`
    - lists the broader query-only tests that must stay outside the curated root lane
  - `pnpm --dir packages/query test`
    - passed (`7` files, `93` tests)
  - `pnpm --dir packages/assistant-runtime test`
    - passed (`8` files, `56` tests)
  - `pnpm --dir packages/assistantd exec vitest list --config vitest.config.ts`
    - includes `test/service.test.ts`, confirming package-local assistantd is broader than the curated root lane
  - `pnpm --dir packages/assistantd test`
    - passed (`3` files, `7` tests)
- Failed: `pnpm typecheck`
  - unrelated dirty-tree failure in `packages/cli/test/cli-expansion-inbox-attachments.test.ts` (`attachments` property type mismatch)
- Failed: `pnpm test:packages`
  - unrelated dirty-tree failures in `packages/cli/test/inbox-cli.test.ts`
- Failed: `pnpm test:coverage`
  - root coverage now reaches the curated Vitest coverage pass and reports the targeted `core` / `hosted-execution` / `importers` / `query` surface again
  - remaining failures are the same unrelated dirty-tree `packages/cli/test/inbox-cli.test.ts` assertions
- Confirmed: stale audit claim
  - `vitest.config.ts` is present in the live tree, checked in, and remains the source of truth for the curated repo package lane
- Passed: required audit passes
  - `simplify` spawned audit suggested one behavior-preserving cleanup: remove redundant package-local `--project <name>` flags once local scripts use local configs
  - follow-up final review after that simplification found no actionable issues beyond unrelated dirty-tree blockers

## Outcome

- Ready to close: repo-lane/package-lane semantics are split correctly again, package-local query/assistant-runtime/assistantd loops all run from local configs, and remaining wrapper failures stay in unrelated CLI dirty-tree work.
Status: completed
Updated: 2026-03-30
Completed: 2026-03-30
