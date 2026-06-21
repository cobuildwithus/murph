# PR 228 ReviewGPT Round 2

## Goal

Resolve accepted ReviewGPT round 2 findings on PR 228 with the smallest durable
browser primitive:

- Keep `computer_act` as a single bounded browser action per call.
- Reserve transport/observation timeout margin so a successful browser action is
  not routinely reported as an unknown outcome.
- Treat non-authoritative browser-state cache writes as best-effort after Kernel
  success.

## Scope

- Shared hosted computer action request schema and directly coupled parser tests.
- Web computer-use service action execution and route tests.
- Assistant dynamic tool schema/output handling, prompt guidance, skill text,
  and directly coupled tests.
- Security/readme docs only where they describe the action contract.

## Non-Goals

- Do not add multiple browser tools.
- Do not reintroduce model-authored JavaScript.
- Do not add a policy engine, queue, approval system, or new browser runtime.

## Verification

- `pnpm --dir packages/hosted-execution typecheck`
- `pnpm --dir apps/web typecheck:prepared`
- `pnpm --dir packages/assistant-engine typecheck`
- `pnpm exec vitest run --config vitest.config.ts --no-coverage test/hosted-execution.test.ts`
  from `packages/hosted-execution`
- `pnpm exec vitest run --config vitest.workspace.ts --no-coverage test/hosted-execution-computer-use.test.ts`
  from `apps/web`
- `pnpm exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-computer-tools.test.ts test/assistant-codex-runtime.test.ts test/assistant-skill-assets.test.ts test/model-behavior.test.ts`
  from `packages/assistant-engine`
- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage apps/cloudflare/test/runner-outbound.test.ts`
  from the repo root
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff $(git ls-files -m -o --exclude-standard)`
- `git diff --check`
- Changed-file privacy scan for local identifiers

All commands above passed. A follow-up PR ReviewGPT pass will run after this
fix is pushed.
Status: completed
Updated: 2026-06-20
Completed: 2026-06-20
