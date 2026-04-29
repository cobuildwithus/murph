# Finish Health Commons route-bundle boundary

Status: completed
Created: 2026-04-29
Updated: 2026-04-29

## Goal

- Finish the route-bundle architecture so generated web data stays canonical and app-owned projections consume it.
- Add the missing biomarker browse/index path, biomarker route-bundle consumption, and guardrails against reintroducing full catalog imports into app route code.

## Success criteria

- `packages/health-commons` emits `web/browse/biomarkers.json` alongside routes, experiment browse data, and route bundles.
- Biomarker routes resolve from route bundles by default and keep reverse-edge protocol relationships available.
- Experiment public layout no longer does auth/cookie/Prisma reads in the route layout; private overlays are lazy/client-side.
- Tests/guards fail if app Health Commons page-model code imports the generated full catalog.

## Scope

- In scope: `packages/health-commons` web artifact generation/runtime, `apps/web` Health Commons resolvers/routes/tests, focused guard scripts/tests.
- Out of scope: broad UI redesign, private run persistence redesign, generated tab-specific artifacts.

## Constraints

- The package must not generate app-shaped `ExperimentProtocol` or `BiomarkerPageModel`.
- Route bundles remain the durable primitive: primary entity, exact dependency closure, scoped evidence/source snippets, reverse edges, and revisions.
- Preserve unrelated dirty-tree changes.

## Verification

- `pnpm --dir packages/health-commons generate:check` passed.
- `pnpm --dir packages/health-commons typecheck` passed.
- `pnpm --dir packages/health-commons test:vitest` passed: 10 files, 38 tests.
- `pnpm --dir apps/web typecheck` passed.
- Focused app Vitest passed: 6 files, 42 tests.
- `git diff --check` on touched paths passed.
- `pnpm test:diff ...` failed in unrelated affected package coverage: `packages/assistant-runtime/test/hosted-runtime-linq-audio-e2e.test.ts` expected one parser input and saw zero. The failing package/test is outside this Health Commons diff.
- `pnpm typecheck` failed in unrelated assistant-engine provider-catalog tests that reference removed `Assistant*` exports; the Health Commons app/package typechecks above passed.

## Review outcomes

- Security/privacy review found two issues; both were fixed:
  - Hidden/deprecated protocol bundles no longer resolve by direct experiment route.
  - Source findings are capped before entering source snippets or source entity bodies.
- Finish review found route-bundle reverse edges were too narrow; fixed by generating route-primary incoming reverse edges and including reverse-edge sources in the bundle closure.
- Coverage pass added a static-first guard for the public experiment layout.
Completed: 2026-04-29
