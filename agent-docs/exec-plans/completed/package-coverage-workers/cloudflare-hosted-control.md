Package owner: `@murphai/cloudflare-hosted-control`
Path: `packages/cloudflare-hosted-control`
Current shape: small package that already passes package-wide coverage, but still has uncovered barrel/contracts seams

Task

Keep `@murphai/cloudflare-hosted-control` on honest package-wide coverage and strengthen it without using curated coverage include lists. The package must continue to use package-wide `coverage.include: ["src/**/*.ts"]`.

Your ownership

- You own `packages/cloudflare-hosted-control/**`.
- You may add package-local helpers under `packages/cloudflare-hosted-control/test/**` if they reduce duplication.
- Do not edit root `vitest.config.ts`, `config/**`, or other packages.
- Preserve unrelated dirty worktree edits.
- Do not commit.

Workflow

1. Read the package config, tests, and current package-wide coverage output.
2. Publish a concise but thorough plan in commentary.
3. Spawn at least one GPT-5.4 `medium` subagent. This is required. Keep ownership disjoint if you use more than one, for example:
   - barrel/contracts/index seams
   - additional client/parser edge cases
4. Add small deterministic tests that improve the uncovered surfaces while preserving package-wide `src/**/*.ts` coverage.
5. Run package-local verification and report the final package-wide status.

Requirements

- Keep the diff small and direct.
- Do not reintroduce curated include lists.
