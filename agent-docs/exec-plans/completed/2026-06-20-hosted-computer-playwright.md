# Hosted Computer Playwright Primitive

## Goal

Give Murph one simple hosted browser primitive that can run bounded Playwright
code against the existing Kernel browser page, so the assistant can click,
fill forms, select slots, and complete shopping or appointment flows through
the existing signed computer-use transport.

## Scope

- Replace the shared hosted computer action contract with a code-only Playwright
  primitive.
- Keep Kernel, browser profiles, run ownership, signed web-control callbacks,
  the Kernel-side public-network guard, live-view secrecy, and sanitized tool
  output in their current owners.
- Add a concise assistant skill file that teaches Murph how to use the primitive
  without adding a large bespoke action vocabulary.
- Update directly coupled docs and tests that currently describe or assert the
  old URL-only action contract.

## Non-Goals

- Do not add separate `click`, `fill`, `select`, or checkout-specific tools.
- Do not move Kernel credentials or live-view URLs into Cloudflare or Codex.
- Do not create a new browser runtime, queue, approval system, or policy engine.

## Files

- `packages/hosted-execution/src/computer-use.ts`
- `apps/web/src/lib/computer-use/service.ts`
- `packages/assistant-engine/src/assistant-codex/dynamic-tools.ts`
- `packages/assistant-engine/src/assistant/system-prompt.ts`
- `packages/assistant-engine/src/assistant-skill-assets.ts`
- `packages/assistant-engine/skills/computer-use/SKILL.md`
- directly coupled tests and docs

## Verification

- Required completion audits run for the hosted trust-boundary change; accepted
  findings were addressed in the final diff.
- Focused hosted computer contract/service/tool tests passed.
- `pnpm typecheck` passed.
- `bash scripts/workspace-verify.sh test:diff ...` passed after one unrelated
  Vitest worker startup failure was rerun successfully.
Status: completed
Updated: 2026-06-20
Completed: 2026-06-20
