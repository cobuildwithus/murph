# Runner Boot Probe Lazy Chunks

## Goal

Extend the runner entrypoint bundle boot probe so the assembled artifact also
evaluates lazy chunks reached through dynamic imports, and prove the chunk
collection behavior with a focused test.

## Constraints

- Keep the existing boot-probe primitive and one subprocess.
- Reuse the current metafile traversal shape instead of duplicating graph
  walking.
- Do not add scripts, config, or new machinery.
- Preserve the entrypoint guard protection by keeping probe paths out of argv.
- Stop if lazy chunk module scope performs IO or network work.

## Plan

1. Refactor the existing output traversal into a shared helper used by the
   static boot-closure check and the new lazy-chunk collector.
2. Pass lazy chunk file URLs to the existing probe subprocess through env and
   import them after the entry import succeeds.
3. Add one synthetic-metafile unit test for lazy chunk collection.
4. Verify with runner bundle assembly, a local corruption sanity check, focused
   runner-bundle tests, and Cloudflare typecheck.

## Verification

- Passed: `pnpm --dir apps/cloudflare runner:bundle`
  - Entry chunk 2,291,540B within baseline 2,288,516B + 48,000B tolerance.
  - Total output 8,210,004B within 9,300,000B budget.
- Passed: local post-build lazy chunk corruption sanity check
  - Temporarily corrupted `conversation-W4C22JD5.js`; probe failed with status
    4 and named the chunk, then restored the file and verified the hash.
- Passed: `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --no-coverage test/runner-bundle-cli-bundle.test.ts test/runner-bundle-contract.test.ts test/runner-bundle-dependency-install.test.ts test/runner-bundle-entrypoint-bundle.test.ts test/runner-bundle-helpers.test.ts test/runner-bundle-process.test.ts test/runner-bundle-runtime-shape.test.ts test/runner-bundle-workspace-artifacts.test.ts test/sync-smoke-runner-bundle.test.ts`
  - 9 files, 72 tests.
- Passed: `pnpm --dir apps/cloudflare typecheck`
Status: completed
Updated: 2026-07-06
Completed: 2026-07-06
