Package owner: `@murphai/gateway-core`
Path: `packages/gateway-core`
Current shape: compact package with strong basic tests but failing package-wide coverage in event-log, opaque ids, routes, and snapshot seams

Task

Raise `@murphai/gateway-core` to honest package-wide coverage with package-wide `coverage.include: ["src/**/*.ts"]`. Do not solve this with curated include lists.

Your ownership

- You own `packages/gateway-core/**`.
- You may add shared test helpers under `packages/gateway-core/test/**` if they reduce duplication.
- Do not edit root/shared coverage config or other packages.
- Preserve unrelated dirty worktree edits.
- Do not commit.

Workflow

1. Read the package config, current tests, and the package-wide coverage failure output.
2. Publish a thorough package plan in commentary:
   - exact failing files and metrics
   - helper reuse opportunities
   - required GPT-5.4 `medium` subagent split
3. Spawn GPT-5.4 `medium` subagents. This is required. Prefer disjoint seams such as:
   - `src/event-log.ts` and `src/snapshot.ts`
   - `src/routes.ts` and `src/opaque-ids.ts`
   - `src/index.ts` and `src/local-runtime.ts` plus any small pure helpers
4. Integrate the changes and keep tests deterministic and package-local.
5. Keep package-wide `coverage.include: ["src/**/*.ts"]`.
6. Run package-local verification and report the final package-wide result.

Requirements

- Prefer high-value branch coverage over line-chasing.
- Reuse existing route/snapshot test setup before adding new scaffolding.
