# Add persistent incremental caches for package-local typecheck

Status: completed
Created: 2026-04-09
Updated: 2026-04-09

## Goal

- Speed up repeated `pnpm typecheck` runs by letting package-local no-emit TypeScript checks reuse `tsbuildinfo` state across invocations.

## Success criteria

- Package-local `tsconfig.typecheck.json` files used by the repo typecheck lane persist reusable incremental state instead of forcing cold runs every time.
- The cache files stay outside tracked source output and are cleaned by existing repo cleanup commands.
- `pnpm typecheck` still passes after the tooling change.
- A repeated local typecheck measurement shows a meaningful reduction in the package/app typecheck phase or total runtime.

## Scope

- In scope:
- package-local `tsconfig.typecheck.json` files
- root cleanup and verification tooling needed to manage the new cache files
- focused docs/plan updates required by the workflow
- Out of scope:
- runtime code changes
- package boundary changes
- unrelated verification failures already present in the branch

## Risks and mitigations

1. Risk: cached no-emit state becomes stale or pollutes the worktree.
   Mitigation: use explicit `tsBuildInfoFile` paths that the repo clean path removes.
2. Risk: changing typecheck config affects build semantics.
   Mitigation: keep the change limited to `tsconfig.typecheck.json` files and leave build configs untouched.
3. Risk: the root package/app lane still spends most of its time elsewhere.
   Mitigation: remeasure after the change and report the actual delta rather than assuming a win.

## Tasks

1. Add explicit incremental cache files to the package-local no-emit typecheck configs that currently disable incremental reuse.
2. Update cleanup tooling if needed so those cache files do not linger as tracked residue.
3. Run required verification and timing measurements.
4. Do the required final review path and land a scoped commit.

## Verification

- Planned:
  - `pnpm typecheck`
  - focused timing checks around `pnpm typecheck:packages` and/or `pnpm typecheck`
- Results:
  - PASS `pnpm typecheck:packages`
    - first measured warm-up run after the config change: `real 18.77`
    - second repeated run on the same tree: `real 9.45`
    - pre-change baseline from the same session: `real 19.61` to `19.62`
  - PASS `pnpm typecheck`
    - current run: `real 27.02`
    - package/app typecheck phase improved slightly from the earlier `16s` baseline to `15s`, but the forced workspace build still dominates the full command
  - FAIL unrelated `pnpm test:diff ...`
    - existing failure in `packages/assistant-engine/test/assistant-local-service-runtime.test.ts:453`
    - the assertion expects a hard-coded `^2026-04-08T` timestamp and failed on the current date with `2026-04-09T00:00:59.352Z`
Completed: 2026-04-09
