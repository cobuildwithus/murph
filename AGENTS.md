# AGENTS.md

## Purpose

This file is the routing map for agent work in this repository.
Durable guidance lives in `agent-docs/`.

## Precedence

1. Explicit user instruction in the current chat turn.
2. `Hard Rules (Non-Negotiable)` in this file.
3. `agent-docs/operations/agent-workflow-routing.md`
4. Other detailed docs under `agent-docs/**`.

If instructions still conflict after applying this order, ask the user before acting.

## Read First

Always read these before repo code/docs/test/config work:

1. `agent-docs/index.md`
2. `ARCHITECTURE.md`
3. `agent-docs/references/repo-scope.md`
4. `agent-docs/operations/agent-workflow-routing.md`

## Task Router

| Task | Also read | Notes |
| --- | --- | --- |
| Vault-only data under `vault/**` | `agent-docs/operations/verification-and-runtime.md` | No repo ledger or repo-wide checks by default. |
| Docs/process-only | `agent-docs/operations/verification-and-runtime.md` | No audit subagents by default. |
| Repo code/test/config | `agent-docs/operations/completion-workflow.md`, `agent-docs/operations/verification-and-runtime.md` | Use the task classes in the workflow-routing doc. |
| UI or `packages/web` | `agent-docs/FRONTEND.md`, `packages/web/AGENTS.md` | Tailwind-only styling. Inspect desktop and mobile before handoff. |
| Auth, secrets, trust boundaries, external runtime surfaces | `agent-docs/SECURITY.md` | Treat as higher-risk by default. |
| Retries, queues, cron, concurrency, failure handling | `agent-docs/RELIABILITY.md` | Capture direct proof for operational changes. |
| Test selection or verification changes | `agent-docs/references/testing-ci-map.md` | Keep test coverage and doc claims aligned. |
| Product behavior or UX tradeoffs | `agent-docs/PRODUCT_SENSE.md`, `agent-docs/PRODUCT_CONSTITUTION.md` | Prefer repo-local durable specs over chat memory. |

## Hard Rules (Non-Negotiable)

- In `packages/web`, use Tailwind utility classes only. Do not add raw CSS files or custom classes in `globals.css`.
- Treat `.env` and `.env*` as sensitive. Never print, commit, or otherwise expose their contents.
- Never print or commit secrets, raw credentials, or full `Authorization` headers.
- Do not introduce new `HB_`, `HEALTHYBOB_`, or similar branded prefixes unless the user explicitly asks for them.
- Import sibling workspace packages by package name through declared public entrypoints only. Do not reach into another package's `src/` or `dist/`.
- Do not reintroduce custom Turbopack loader-based rewriting for repo-local workspace sources.
- Historical plan docs under `agent-docs/exec-plans/completed/` are immutable snapshots.
- Do not invent compatibility, deployment, or runtime requirements. Document them in repo docs and scripts in the same change that introduces them.

## Workflow Defaults

- Repo code/docs/test/config work uses `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`; vault-only data work does not by default.
- Preserve unrelated worktree edits. Do not overwrite, discard, or revert work you did not make.
- Use an execution plan for multi-file or high-risk work. Narrow supplied-patch landings may stay ledger-only when they remain bounded and single-turn.
- If architecture-significant behavior changes, update `ARCHITECTURE.md` and the matching durable docs.
- Same-turn task completion counts as acceptance unless the user says `review first` or `do not commit`.
- Use `scripts/finish-task` for plan-bearing commits and `scripts/committer` otherwise.
- Update `agent-docs/index.md` when durable docs are added, removed, moved, or materially repurposed.

## Notes

- This file should stay a compact router, not a policy manual. Target roughly 100 lines or less and keep the structure limited to: purpose, precedence, read-first docs, task router, non-negotiables, workflow defaults, and notes.
- Keep this file short and route-oriented. Move durable detail into `agent-docs/`.
