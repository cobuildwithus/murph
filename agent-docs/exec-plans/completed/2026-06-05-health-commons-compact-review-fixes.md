# Health Commons Compact Artifact Review Fixes

Created: 2026-06-05

## Goal

Fix the review findings from the Health Commons runtime-catalog removal PR with
the smallest durable changes:

- compact protocol readers resolve existing Health Commons redirects;
- compact protocol search preserves the useful old protocol/body search path;
- compact lookups are case-insensitive for keys, slugs, route ids, and aliases;
- public compact protocol artifacts do not expose hidden or deprecated protocol
  variants;
- hosted runner deploy preflight validates the compact artifact set as a
  coherent runtime contract instead of only checking one sentinel protocol.

## Constraints

- Do not reintroduce `generated/catalog.json` or a runtime monolith.
- Do not add a daemon, cache, framework, command parser, or extra runtime
  service.
- Keep the artifact split simple: index, run specs, family graph.
- Prefer adding fields to the existing compact projection over adding a new
  artifact family unless proof shows the current split cannot support the
  behavior.

## Plan

1. Add redirect-derived lookup ids and compact protocol-index search text at
   generation time.
2. Make compact lookup normalization type-aware, decoded, and case-insensitive.
3. Filter public protocol compact artifacts to visible, non-deprecated
   protocols and families.
4. Tighten deploy-side artifact validation and cross-file consistency checks.
5. Keep graph artifacts graph-only; use the protocol index for query fallback.
6. Add focused tests for redirects, typed-prefix lookup, body search, hidden
   exclusion, assistant protocol recognition, and deploy validation failures.
7. Run Health Commons, CLI, Cloudflare, and assistant-engine verification.

## Verification

Passed:

- `pnpm --filter @murphai/health-commons typecheck`
- `pnpm --filter @murphai/murph typecheck`
- `pnpm --filter @murphai/cloudflare-runner typecheck`
- `pnpm --filter @murphai/assistant-engine typecheck`
- `pnpm exec vitest run --config packages/health-commons/vitest.config.ts --no-coverage packages/health-commons/test/runtime.test.ts`
- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/commons-command-coverage.test.ts packages/cli/test/cli-expansion-experiment-journal-vault-phase2.test.ts`
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/deploy-artifacts.test.ts`
- `pnpm --filter @murphai/health-commons test`
- `pnpm --filter @murphai/murph test:source`
- `pnpm --filter @murphai/cloudflare-runner test:node`
- `pnpm --filter @murphai/assistant-engine test`
- `pnpm --filter @murphai/health-commons generate:check`
- `git diff --check`

Review:

- Local deep-review pass plus two review-only subagents. Follow-up fixes from
  review: assistant protocol index now reads compact protocol index, graph
  artifact no longer carries search text, typed lookup decodes/case-normalizes
  prefixes, deploy validation compares shared summaries, checks edge direction,
  requires usable route ids, requires index search text, and rejects obsolete
  generated runtime payloads.
Status: completed
Updated: 2026-06-05
Completed: 2026-06-05
