# Implement Health Commons route-scoped web bundles for experiments

Status: completed
Created: 2026-04-29
Updated: 2026-04-29

## Goal

- Replace hosted experiment-page runtime reads of the full Health Commons catalog with route-scoped generated web artifacts.
- Keep the canonical Health Commons catalog available for build/research tooling while giving public web routes a small, static-first data source.

## Success criteria

- `packages/health-commons` generates deterministic web route bundles and compact experiment browse/index artifacts.
- `apps/web` experiment detail pages resolve protocols from the route-scoped bundle path rather than importing `generated/catalog.json`.
- `/experiments` browse data no longer needs full detail projection for every protocol.
- Existing experiment detail UI receives the same current `ExperimentProtocol` shape through app-local projection code.
- Focused tests prove resolver parity and generated bundle closure behavior.

## Scope

- In scope:
- New generated web artifacts under `packages/health-commons/generated/web/**`.
- Package-level route-bundle builder/reader code and schemas owned by `packages/health-commons`.
- App-local experiment projection/resolver changes in `apps/web/src/lib/health-commons/**`.
- Static params for public experiment detail routes where compatible with existing layout changes.
- Out of scope:
- Reworking private browser-vault run persistence or hosted message delivery.
- Redesigning experiment detail UI layout/copy.
- Landing unrelated Health Commons research/content changes.
- Replacing the full catalog for CLI/research tooling.

## Constraints

- Technical constraints:
- Do not generate app-shaped `ExperimentProtocol` as package truth; web projections remain app-local.
- Avoid duplicating full source bodies into every bundle; source snippets/pointers should be enough for current web projections.
- Preserve exact `key`, `pageRevisionId`, `runSpecRevisionId`, recipe/catalog hashes, and test-plan identity where present.
- Product/process constraints:
- Public Health Commons artifacts must not include private run data or raw contribution records.
- Preserve unrelated dirty-tree edits and active experiment/browser-vault rows.

## Risks and mitigations

1. Risk: A route bundle misses relation data currently found through global catalog lookups.
   Mitigation: Build explicit entity closures and parity tests for protocol detail projection.
2. Risk: Generated bundle schema becomes too UI-shaped.
   Mitigation: Keep the bundle as canonical entity closure plus scoped evidence/snippets; project to UI types in `apps/web`.
3. Risk: Static route changes conflict with active experiment CTA/browser-vault work.
   Mitigation: Read current dirty files before touching them and keep route edits minimal.

## Tasks

1. Add route-bundle and compact experiment index generation in `packages/health-commons`.
2. Add package reader helpers for generated web artifacts.
3. Port experiment detail/list resolvers to bundle/index-backed data.
4. Add static params for experiment detail route segments if compatible.
5. Add focused tests and run required verification/audits.

## Decisions

- The durable primitive is a route-scoped entity closure, not generated `ExperimentProtocol`.
- Full `catalog.json` remains the bulk/source-of-truth artifact for generator validation and research tooling.
- The public `/experiments` browse list uses `web/browse/experiments.json` directly rather than loading every route bundle.
- Route bundles use an allowlisted public projection, compact source snippets, and runtime assertions for compacted source bodies.

## Verification

- Passed:
- `pnpm --dir packages/health-commons generate`
- `pnpm --dir packages/health-commons generate:check`
- `pnpm --dir packages/health-commons typecheck`
- `pnpm --dir packages/health-commons test:vitest`
- `pnpm --dir packages/health-commons test:vitest -- test/runtime.test.ts`
- `pnpm --dir apps/web typecheck`
- `pnpm typecheck`
- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/health-commons-bryan-johnson-protocol.test.ts apps/web/test/health-commons-experiment-detail-page.test.ts apps/web/test/health-commons-experiment-onboarding.test.ts`
- `git diff --check` over touched files
- Identifier/cast hygiene scan over touched source/test paths returned no matches.
- Artifact proof:
- `packages/health-commons/generated/web/browse/experiments.json` is about 52 KB.
- Detail bundles remain route-scoped; current protocol examples are about 1.1 MB for Finnish sauna and 1.9 MB for Bryan Johnson sauna.
- Known unrelated blocker:
- `pnpm test:diff` failed before this final state in unrelated dirty-tree/repo-tool tests and generated Next artifact checks outside this task slice.
Completed: 2026-04-29
