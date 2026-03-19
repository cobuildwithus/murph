# AGENTS.md

## Purpose

This file is the routing map for agent work in this repository.
Durable guidance lives in `agent-docs/`.

## Precedence

1. Explicit user instruction in the current chat turn.
2. `Hard Rules (Non-Negotiable)` in this file.
3. Other sections in this file.
4. Detailed process docs under `agent-docs/**`.

If instructions still conflict after applying this order, ask the user before acting.

## Read Order

1. `agent-docs/index.md`
2. `ARCHITECTURE.md`
3. `agent-docs/PRODUCT_SENSE.md`
4. `agent-docs/RELIABILITY.md`
5. `agent-docs/SECURITY.md`
6. `agent-docs/references/repo-scope.md`
7. `agent-docs/references/testing-ci-map.md`
8. `agent-docs/operations/verification-and-runtime.md`
9. `agent-docs/operations/completion-workflow.md`

## Hard Rules (Non-Negotiable)

- Always use Tailwind CSS utility classes in the web package (`packages/web`). No raw CSS — do not add custom classes to `globals.css` or create new `.css` files. All styling must be expressed as Tailwind utilities in JSX `className` props. The theme (colors, fonts, shadows, animations) is defined via `@theme` in `globals.css`.
- Never access `.env` or `.env*` files.
- Never print or commit full secrets, tokens, raw credentials, or full `Authorization` headers.
- Historical plan docs under `agent-docs/exec-plans/completed/` are immutable snapshots.
- COORDINATION_LEDGER hard gate for every coding task (single-agent and multi-agent): before any code change, add or update your active entry in `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` with scope and planned symbol add/rename/delete work; do not edit code, generate code, or apply patches until that entry exists; if you cannot update the ledger first, stop and escalate; keep the entry current as scope changes, and remove your entry when done.
- Ledger rows are active-work notices by default, not hard file locks. Read overlapping rows first, preserve adjacent edits, and coordinate through scope/symbol notes. Treat a row as exclusive only when it explicitly says overlap is unsafe, the lane is a large refactor, or the user gives a conflicting direction.
- Any spawned subagent that may review or edit code must read `COORDINATION_LEDGER.md`, follow the same hard gate before making code changes, and honor any explicit exclusive/refactor notes on overlapping rows.
- For non-doc changes that touch production code or tests, run completion workflow audit passes: `simplify` -> `test-coverage-audit` -> `task-finish-review`.
- Docs/process-only changes skip completion workflow audit passes unless the user explicitly asks to run them.
- Until product/runtime tooling exists, do not invent fake compatibility or deployment requirements; define them in `agent-docs/operations/verification-and-runtime.md` and `package.json` in the same change that introduces them.
- Keep this file short and route-oriented; move durable detail into `agent-docs/`.

## How To Work

- Before implementation, do a quick assumptions check; ask only for high-impact clarifications.
- Continue working in the current tree even when unrelated external dirty changes appear.
- Never revert, delete, or rewrite existing edits you did not make unless the user explicitly asks.
- Keep files under roughly 500 lines when practical; only introduce or preserve larger files when there is a clear reason they need to stay that large.
- Prefer narrow ledger rows and symbol claims. If you need temporary exclusive control of a file or symbol cluster, say so explicitly in the row notes and explain why overlap is unsafe.
- If architecture-significant behavior changes, update matching docs in `agent-docs/` and `ARCHITECTURE.md`.
- For multi-file or high-risk work, add an execution plan in `agent-docs/exec-plans/active/`.
- When the first real app/service/tooling modules land, update the verification docs and package scripts in the same change so the harness stays truthful.

## Commit and Handoff

- Same-turn task completion = acceptance, unless the user explicitly says `review first` or `do not commit`.
- If you changed files, run the required checks defined below before handoff. If they pass, run `scripts/committer "type(scope): summary" path/to/file1 path/to/file2`.
- If a required check fails for a credibly unrelated pre-existing reason, do not leave your scoped work uncommitted solely because the repo is red. Commit your exact touched files after recording the failing command, the failing target, and why your diff did not cause it. If you cannot defend that causal separation, treat the failure as blocking.
- Use `scripts/committer` only (no manual `git commit`).
- Agent-authored commit messages should use Conventional Commits (`feat|fix|refactor|build|ci|chore|docs|style|perf|test`).
- If no files changed, do not create a commit.
- Commit only exact file paths touched in the current turn.
- Do not skip commit just because the tree is already dirty.
- If a touched file already had edits, still commit and explicitly note that in handoff.

## Required Checks

- Current bootstrap baseline:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- These bootstrap commands currently validate shell-wrapper syntax plus docs drift/gardening integrity.
- When repo-specific code/tooling is introduced, replace or extend these commands rather than bypassing them.

## Notes

- `agent-docs/index.md` is the canonical docs map. Update it whenever docs move or change.
