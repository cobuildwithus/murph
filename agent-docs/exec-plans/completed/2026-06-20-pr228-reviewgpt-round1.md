# PR 228 ReviewGPT Round 1

## Goal

Resolve the accepted ReviewGPT round 1 findings on PR 228 with the smallest
maintainable architecture:

- Replace raw model-authored Playwright source execution with a server-owned
  bounded browser-step primitive.
- Keep a temporary legacy `goto` request path on the web-control endpoint so old
  runners continue to work during gradual rollout.

## Scope

- Shared hosted computer action request schema and directly coupled parser tests.
- Web computer-use service action execution and route tests.
- Assistant dynamic tool schema/output handling, prompt guidance, skill text,
  and directly coupled tests.
- Deployment/security docs and PR review artifacts as local uncommitted evidence
  only.

## Non-Goals

- Do not add multiple browser tools.
- Do not keep raw JavaScript source as a model-facing action contract.
- Do not add a new browser runtime, queue, approval system, or policy engine.

## Verification

- `pnpm --dir packages/hosted-execution typecheck`
- `pnpm --dir apps/web typecheck:prepared`
- `pnpm --dir packages/assistant-engine typecheck`
- `pnpm exec vitest run --config vitest.config.ts --no-coverage test/hosted-execution.test.ts`
  from `packages/hosted-execution`
- `pnpm exec vitest run --config vitest.workspace.ts --no-coverage test/hosted-execution-computer-use.test.ts`
  from `apps/web`
- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage apps/cloudflare/test/runner-outbound.test.ts`
  from the repo root
- `pnpm exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-computer-tools.test.ts test/assistant-codex-runtime.test.ts test/assistant-skill-assets.test.ts test/model-behavior.test.ts`
  from `packages/assistant-engine`
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff $(git ls-files -m -o --exclude-standard)`
- `git diff --check`
- Changed-file privacy scan for local identifiers

All commands above passed. A second PR ReviewGPT pass will run after this fix is
pushed because the reviewer reads the pushed PR branch.
Status: completed
Updated: 2026-06-20
Completed: 2026-06-20
