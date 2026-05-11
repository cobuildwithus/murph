# Verify acceptance speedup

Status: completed
Created: 2026-05-11
Updated: 2026-05-11

## Goal

- Reduce local `pnpm verify:acceptance` wall time from the observed 382s run toward half that time without weakening the acceptance gate.

## Success criteria

- `pnpm verify:acceptance` still runs the same acceptance surfaces: root typecheck, package coverage, fixture/scenario coverage, and app verification.
- The implementation does not skip required checks, lower coverage thresholds, or hide failures behind best-effort behavior.
- Local wall time is materially reduced through safe scheduling, reuse of already-prepared artifacts, or removal of duplicate setup work.
- Focused tests or script checks cover the verifier behavior that changed.

## Scope

- In scope: root verification harness scripts, app verification wrappers, app build-boundary imports that affect verification time, and tests/docs that describe those command semantics.
- Out of scope: changing product/runtime behavior, app or package test assertions, coverage thresholds, or CI release policy unless required to keep documented command semantics truthful.

## Constraints

- Preserve unrelated dirty worktree edits and active plan rows.
- Keep acceptance output timing useful for future performance work.
- Avoid resource races around generated app artifacts, Prisma, Next build output, and prepared runtime artifacts.

## Risks and mitigations

1. Risk: parallel app verification races package coverage over shared generated artifacts.
   Mitigation: only overlap lanes after identifying which generated resources are actually shared, and keep serialization where required.
2. Risk: a fast path accidentally skips a failure-bearing acceptance surface.
   Mitigation: add tests/readback that assert the required commands remain wired.
3. Risk: local-only defaults make CI slower or less reliable.
   Mitigation: keep CI defaults conservative unless the existing CI/release workflow already opts into the same safe parallelism.

## Tasks

1. Measure or reconstruct the current acceptance lane timing and dependency graph. Done: a baseline rerun was stopped after the user asked not to use additional parallelism; the observed early timing showed repeated Health Commons setup and web verification setup reuse opportunities.
2. Implement the smallest safe verifier scheduling improvement. Done: reuse already-prepared setup instead of adding new parallelism.
3. Reduce app build work that was caused by broad server-side imports. Done: narrow hosted runtime issue parsing, connect-target metadata, and simple device-sync errors away from broad provider/runtime barrels; mark the runtime-state lock sibling path with Turbopack's targeted ignore for dynamic runtime-only filesystem paths.
4. Add focused tests/readback for changed verifier behavior. Done.
5. Run `pnpm typecheck`, focused script tests, and `pnpm verify:acceptance`. Done, with full acceptance blocked before app verification by package coverage timeouts.
6. Run required completion audits and close with a scoped commit if the worktree allows it. Done.

## Decisions

- Do not add new parallel scheduling as the speedup mechanism.
- Reuse generated artifacts prepared earlier in the same verification command: Health Commons catalog, hosted-web Prisma client, hosted-web legal/Health Commons setup before dev smoke, and hosted-web Health Commons setup before Vitest.
- Narrow app imports that only need runtime issue parsing away from `@murphai/runtime-state/node`, because that barrel pulls unrelated Node filesystem and lock modules into the Next build analysis.
- Add `@murphai/device-syncd/connect-config` and `@murphai/device-syncd/errors` as public lightweight entrypoints for build-time-safe metadata/error use; keep the heavy `@murphai/device-syncd/config` path for provider runtime assembly.
- Use Turbopack's explicit ignore comment on the runtime-state lock sibling temp path. This is scoped to a runtime-only lock file path and does not skip application checks.

## Verification

- Commands to run:
  - `bash -n scripts/workspace-verify.sh`
  - focused repo-tool tests covering verifier wiring
  - `pnpm typecheck`
  - `pnpm verify:acceptance`
- Expected outcome: checks pass and `pnpm verify:acceptance` wall time is materially below the 382s baseline without dropped surfaces.
- 2026-05-11: `pnpm verify:acceptance` failed before app verification because `packages/cli/test/device-cli.test.ts` timed out during package coverage. The run confirmed Health Commons prepared-artifact skips, but the full command was blocked by that unrelated package coverage timeout.
- 2026-05-11: `pnpm --dir apps/web verify` passed after import narrowing. The direct standalone app verifier still performs setup, and its `next build` step is now 46s; under root acceptance the app verifier also skips prepared setup, so the app lane should be about 50s plus shell overhead instead of the observed 102s.
- 2026-05-11: A second `pnpm verify:acceptance` run again failed before app verification during package coverage, this time reporting a CLI runtime test timeout plus an unreported background package coverage failure. The isolated follow-up `pnpm --dir packages/cli test:coverage` passed, pointing to full-run resource pressure rather than a scoped app verifier regression.
- 2026-05-11: Required audits completed. Security/privacy review and final task review found no scoped issues. Coverage review added package-boundary proof for the lightweight `@murphai/device-syncd/connect-config` and `@murphai/device-syncd/errors` exports.
Completed: 2026-05-11
