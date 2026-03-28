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
4. `agent-docs/PRODUCT_CONSTITUTION.md`
5. `agent-docs/FRONTEND.md`
6. `agent-docs/RELIABILITY.md`
7. `agent-docs/SECURITY.md`
8. `agent-docs/references/repo-scope.md`
9. `agent-docs/references/testing-ci-map.md`
10. `agent-docs/operations/verification-and-runtime.md`
11. `agent-docs/operations/completion-workflow.md`
12. `packages/web/AGENTS.md`

## Hard Rules (Non-Negotiable)

- Always use Tailwind CSS utility classes in the web package (`packages/web`). No raw CSS — do not add custom classes to `globals.css` or create new `.css` files. All styling must be expressed as Tailwind utilities in JSX `className` props. The theme (colors, fonts, shadows, animations) is defined via `@theme` in `globals.css`.
- For `packages/web` UI work, treat the app as an operator-facing observability surface by default: utility copy first, workspace/status hierarchy first, and no marketing-style hero treatment unless the user explicitly asks for it.
- Treat `.env` and `.env*` files as sensitive inputs. Murph's CLI may load local `.env.local` and `.env` files at runtime for operator configuration, but agents must never print, commit, or otherwise expose their contents.
- Do not introduce new `HB_`, `HEALTHYBOB_`, or similarly branded prefixes for env vars, error codes, config keys, identifiers, or docs unless the user explicitly asks for them; prefer neutral names.
- Never print or commit full secrets, tokens, raw credentials, or full `Authorization` headers.
- Inside this monorepo, source/test/config code must import sibling workspace packages by package name and only through declared public entrypoints; do not reach into another package's `src/` or `dist/` tree. Keep repo-local Next/Vitest source aliasing in `config/workspace-source-resolution.ts`, and do not add TS paths, aliases, or package-local typecheck steps that point internal consumers at sibling `dist/` output. Treat `dist/` as a publish/runtime artifact only.
- Do not reintroduce custom Turbopack loader-based rewriting for repo-local workspace sources. Keep Next on `transpilePackages`, keep shared Next/Vitest source mapping in `config/workspace-source-resolution.ts`, and let TypeScript's `rewriteRelativeImportExtensions` own local relative `.ts` import rewriting.
- Historical plan docs under `agent-docs/exec-plans/completed/` are immutable snapshots.
- Default inbox, auto-reply, and vault-maintenance work is data work, not repo work: when the task's intended writes stay under `vault/**`, keep the work inside the vault and do not edit repo code/docs/process files unless the user explicitly asks for tooling or instruction changes.
- COORDINATION_LEDGER hard gate applies to repo code/docs/test/config changes only. It does not apply to vault-only data tasks whose writes stay under `vault/**`.
- Ledger rows are active-work notices by default, not hard file locks. Read overlapping rows first, preserve adjacent edits, and coordinate through scope/symbol notes. Treat a row as exclusive only when it explicitly says overlap is unsafe, the lane is a large refactor, or the user gives a conflicting direction.
- Any spawned subagent that may review or edit code must read `COORDINATION_LEDGER.md`, follow the same hard gate before making code changes, and honor any explicit exclusive/refactor notes on overlapping rows.
- Spawned subagents should default to a non-mini frontier model with `high` reasoning effort. Do not use mini variants unless the user explicitly asks for one or the task is purely trivial and the user has not asked for deeper thinking.
- For non-doc repo changes that touch production code or tests, run completion workflow audit passes in order: `simplify` -> `test-coverage-audit` -> `task-finish-review`.
- Those required audit passes must be executed explicitly via spawned subagents using the matching docs in `agent-docs/prompts/`; do not treat local self-review by the main implementation agent as satisfying the requirement.
- Treat the repo's mandatory completion-workflow audit passes as standing maintainer authorization for the required spawned subagents. When the current environment supports spawned agents, do not pause only to ask for separate delegation permission for those required audit passes. If the environment or tool policy still blocks subagents, say so explicitly and follow the higher-priority constraint.
- Do not wait for an explicit user request before launching those required completion-workflow audit subagents; repo policy already authorizes them for qualifying changes.
- Docs/process-only changes and vault-only data tasks skip completion workflow audit passes unless the user explicitly asks to run them.
- For UI-affecting `packages/web` changes, inspect the rendered result at desktop and mobile sizes before handoff.
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
- If you changed files, run the required checks defined below before handoff. If the task used an execution plan, close it and commit with `scripts/finish-task agent-docs/exec-plans/active/<plan>.md "type(scope): summary" path/to/file1 path/to/file2`. Otherwise run `scripts/committer "type(scope): summary" path/to/file1 path/to/file2`.
- If a required check fails for a credibly unrelated pre-existing reason, do not leave your scoped work uncommitted solely because the repo is red. Commit your exact touched files after recording the failing command, the failing target, and why your diff did not cause it. If you cannot defend that causal separation, treat the failure as blocking.
- Use `scripts/finish-task` for plan-bearing tasks and `scripts/committer` otherwise (no manual `git commit`).
- Agent-authored commit messages should use Conventional Commits (`feat|fix|refactor|build|ci|chore|docs|style|perf|test`).
- If no files changed, do not create a commit.
- Commit only exact file paths touched in the current turn.
- Do not skip commit just because the tree is already dirty.
- If a touched file already had edits, still commit and explicitly note that in handoff.

## Required Checks

- Current bootstrap baseline for repo code/docs/test changes:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Vault-only data tasks under `vault/**` do not run repo-wide verification by default. Verify them by reading back the touched records plus any audit or ledger entries written by the mutation path.
- These bootstrap commands currently validate shell-wrapper syntax plus docs drift/gardening integrity.
- When repo-specific code/tooling is introduced, replace or extend these commands rather than bypassing them.

## Notes

- `agent-docs/index.md` is the canonical docs map. Update it whenever docs move or change.
