Package owner: `@murphai/gateway-local`
Path: `packages/gateway-local`
Current shape: moderate package with existing store/source-sync tests but broad package-wide coverage gaps in local service, send, store, schema, and snapshot-state seams

Task

Raise `@murphai/gateway-local` to honest package-wide coverage. The package must keep package-wide `coverage.include: ["src/**/*.ts"]`; do not use curated include lists.

Your ownership

- You own `packages/gateway-local/**`.
- You may add package-local shared helpers under `packages/gateway-local/test/**`.
- Do not edit root/shared coverage config or other packages.
- Preserve unrelated dirty worktree edits.
- Do not commit.

Workflow

1. Read the package config, current tests, and the package-wide coverage failure output.
2. Start with a thorough plan in commentary:
   - failing files and biggest branch gaps
   - helper reuse opportunities
   - required GPT-5.4 `medium` subagent split
3. Spawn GPT-5.4 `medium` subagents. This is required. Prefer disjoint ownership such as:
   - `src/local-service.ts` and `src/send.ts`
   - `src/store.ts` plus `src/store/schema.ts`
   - `src/store/snapshot-state.ts` and `src/store/source-sync.ts`
4. Integrate the changes, favoring existing store/source-sync helpers instead of new duplicate setup.
5. Keep package-wide `coverage.include: ["src/**/*.ts"]`.
6. Run package-local verification and report the final package-wide result.

Requirements

- Keep tests deterministic and local.
- Bias toward shared store fixtures rather than one-off copies.
