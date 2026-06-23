# PR 261 Playwright Contract Cleanup

## Goal

Simplify the hosted computer-use raw Playwright contract after review feedback and user direction.

## Success Criteria

- `computer_start_run` no longer exposes or accepts model-owned resume ids.
- Web resumes the member's single active awaiting run from hidden mailbox proof and delivery context.
- `computer_act` returns the Playwright wrapper result to the model again.
- Persisted computer-use failure logs keep actionable redacted error/cause text without storing raw action source.
- Prompt, skill, durable docs, and focused tests match the simplified contract.

## Scope

- `packages/hosted-execution/src/computer-use.ts`
- `packages/assistant-engine/src/assistant-codex/dynamic-tools.ts`
- `packages/assistant-engine/src/assistant/system-prompt.ts`
- `packages/assistant-engine/skills/computer-use/SKILL.md`
- `apps/web/src/lib/computer-use/**`
- Relevant tests and durable docs

## Non-Goals

- No Playwright facade or AST policy parser.
- No new persisted state owner, scheduler, queue, or compatibility layer.
- No local audit subagent passes because the user explicitly opted out for this follow-up.

## Verification Plan

- Focused hosted computer-use web tests.
- Focused assistant-engine computer/prompt/skill tests.
- `pnpm typecheck`.
- `git diff --check` and privacy scan before commit.

## State

- Work continues on PR 261's branch after ReviewGPT rounds and user-selected tradeoffs.
- Main is currently ahead and this PR is marked dirty; conflict resolution is outside this cleanup unless explicitly requested.
Status: completed
Updated: 2026-06-23
Completed: 2026-06-23
