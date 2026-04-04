# Assistant Target Cutover Follow-Up

## Goal

Finish the remaining assistant target/session cleanup so hosted execution no longer accepts `codex-cli` bootstrap config anywhere and the assistant target/session/failover flow resolves through one explicit execution-plan seam.

## Why now

- The previous cutover landed the canonical `AssistantModelTarget` plus separate `resumeState`, but an audit found one real hosted leftover: `HOSTED_ASSISTANT_PROVIDER=codex-cli` still parsed in hosted bootstrap code.
- The same audit also found that session target resolution and route/failover resolution still stop short of one explicit execution-plan object, which leaves the planner simplification incomplete.

## Intended end state

- Hosted assistant bootstrap accepts only OpenAI-compatible targets and aliases.
- Hosted runtime state/types describe hosted providers as OpenAI-compatible only.
- Session target resolution and route/failover construction share one explicit planner that merges boundary defaults, persisted session target, and per-turn override once.
- `ARCHITECTURE.md` continues to describe hosted assistant automation as OpenAI-compatible only and the planner seam as explicit.

## Scope

- `packages/assistant-core/src/hosted-assistant-config.ts`
- `packages/assistant-core/src/assistant/{execution-plan.ts,service-turn-routes.ts,session-resolution.ts}`
- `packages/assistant-runtime/src/hosted-runtime/{context.ts,maintenance.ts,models.ts,summary.ts}`
- Focused tests in `packages/assistant-runtime/test/hosted-assistant-bootstrap.test.ts` and `packages/cli/test/assistant-robustness.test.ts`
- `ARCHITECTURE.md` if the planner/hosted wording needs a durable update

## Constraints

- Do not re-enable hosted Codex bootstrap or hosted Codex profile support.
- Preserve local/operator Codex support.
- Keep backward-compatibility readers for persisted session/config records intact unless a change is directly required for this cleanup.
- Preserve unrelated dirty-tree edits in the assistant prompt/first-contact files and unrelated completed-plan docs.

## Plan

1. Hard-cut hosted env/bootstrap parsing so hosted accepts only OpenAI-compatible providers and aliases.
2. Introduce an explicit assistant execution-plan helper and route session/turn planning through it.
3. Narrow hosted runtime provider types to OpenAI-compatible only and refresh durable architecture wording if needed.
4. Add focused regression tests, run required verification, run required audit pass(es), then commit only the touched paths.

## Verification target

- `pnpm typecheck`
- Focused hosted/assistant Vitest coverage for the touched lanes

## Notes

- This is a follow-up completion lane for the already-landed assistant target/session cutover, not a fresh architecture redesign.
Status: completed
Updated: 2026-04-05
Completed: 2026-04-05
