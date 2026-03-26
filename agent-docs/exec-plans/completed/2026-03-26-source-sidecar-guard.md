# 2026-03-26 Source Sidecar Guard

## Goal

- Prevent accidental TypeScript emits from writing `.js` / `.d.ts` sidecars into source trees.
- Make repo bundle/verification cleanup remove only generated untracked sidecars, without touching active `.ts` worktree edits.
- Keep the public `pnpm` command surface stable.

## Constraints

- Do not remove or rewrite in-progress `.ts` edits.
- Preserve existing build outputs under `dist/` and existing typecheck/test semantics.
- Keep cleanup scoped to untracked generated sidecars adjacent to tracked TypeScript source files.

## Audit Focus

- Root `package.json` scripts and all workspace `package.json` scripts that invoke `tsc`, `tsx`, `next`, `vitest`, or package build wrappers.
- Shared/base/build/typecheck `tsconfig*.json` files for `noEmit`, `outDir`, and `rootDir` behavior.
- Bundle/test wrappers that should self-heal from local generated residue.

## Expected Changes

- Set the shared base tsconfig to `noEmit: true`.
- Set build/test tsconfigs that intentionally emit to `noEmit: false`.
- Add a prune helper for untracked generated sidecars and run it before `no-js` / source-bundle guards, plus expose it through cleanup.
- Update verification docs to match the actual cleanup behavior.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- completion workflow audit passes: simplify, test-coverage-audit, task-finish-review

## Outcome

- Audit result: no current workspace `package.json` script should emit side-by-side JS/declaration files into source trees; the repo-owned in-place emit risk came from direct compilation of `tsconfig.base.json`, which inherited declaration/source-map emit without an `outDir`.
- Implemented: `tsconfig.base.json` now defaults to `noEmit: true`, every build/test tsconfig that intentionally emits now opts back into `noEmit: false`, and root cleanup/handwritten-source guards now prune only untracked generated sidecars adjacent to tracked TypeScript sources before enforcing the artifact policy.
- Cleanup result: the existing generated source sidecars under `packages/**/src` were removed without touching tracked or in-progress `.ts` source edits.
- Verification passed: `pnpm no-js`, `pnpm build`, `pnpm zip:src`, the focused `packages/web/test/check-no-js.test.ts` run, and `pnpm typecheck`.
- Verification blocked by unrelated pre-existing failures: `pnpm test` still fails in the built CLI path because `pnpm --dir packages/cli build` hits the existing `TS6059` / `TS6307` cross-workspace rootDir/file-list issue already noted in `agent-docs/exec-plans/active/2026-03-26-auto-reply-stall-watchdog.md`; `pnpm test:coverage` still fails in unrelated `packages/core` tests with assertion mismatches around canonical write-batch and registry error expectations.
