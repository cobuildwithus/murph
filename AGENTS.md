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
| Review-only repo inspection with no file edits planned | `agent-docs/operations/verification-and-runtime.md` | No repo ledger or repo-wide checks by default unless the user asks for runtime proof. |
| Docs/process-only | `agent-docs/operations/verification-and-runtime.md` | No audit subagents by default. |
| Repo code/test/config | `agent-docs/operations/completion-workflow.md`, `agent-docs/operations/verification-and-runtime.md` | Use the task classes in the workflow-routing doc. When that workflow requires audit subagents, spawn them; repo policy already authorizes those passes. |
| Auth, secrets, trust boundaries, external runtime surfaces | `agent-docs/SECURITY.md` | Treat as higher-risk by default. |
| Retries, queues, cron, concurrency, failure handling | `agent-docs/RELIABILITY.md` | Capture direct proof for operational changes. |
| Test selection or verification changes | `agent-docs/references/testing-ci-map.md` | Keep test coverage and doc claims aligned. |
| Product behavior or UX tradeoffs | `agent-docs/PRODUCT_SENSE.md`, `agent-docs/PRODUCT_CONSTITUTION.md` | Prefer repo-local durable specs over chat memory. |

## Hard Rules (Non-Negotiable)

- Treat `.env` and `.env*` as sensitive. Never print, commit, or otherwise expose their contents.
- Never print or commit secrets, raw credentials, or full `Authorization` headers.
- Do not introduce new `HB_`, `HEALTHYBOB_`, or similar branded prefixes unless the user explicitly asks for them.
- Import sibling workspace packages by package name through declared public entrypoints only. Do not reach into another package's `src/` or `dist/`.
- Workspace package dependencies must remain one-way and acyclic. Do not make package `A` depend on package `B` while `B` depends on `A`, whether directly, through public subpaths, or through compatibility shims.
- Compatibility shims must be temporary and legacy-facing only. Keep the shim on the old path pointing at the new owner; never make the owning package depend on the legacy package to provide the same surface.
- Shared runtime or domain logic must live below CLI/app packages in one owning package. If multiple siblings need the same code, move it to a shared owner instead of cross-importing sibling internals, building helper grab-bags across layers, or using sibling-to-sibling re-exports.
- Do not reintroduce custom Turbopack loader-based rewriting for repo-local workspace sources.
- Dependency changes are high-risk: do not add or update npm packages unless the same change also updates the committed lockfile, uses the public registry instead of git/url/file/alias specs, and records why a repo-local helper or built-in API was not sufficient.
- After dependency updates on a trusted machine, review blocked install scripts with `pnpm deps:ignored-builds` / `pnpm deps:approve-builds`, keep `allowBuilds` entries minimal, and never set `dangerouslyAllowAllBuilds: true`.
- When a hotfix needs a pnpm supply-chain exception, prefer version-scoped `minimumReleaseAgeExclude` or `trustPolicyExclude` entries over package-wide carve-outs, and document the reason in the handoff.
- Outside intentional dependency-edit flows, installs and setup paths must use the committed lockfile with `pnpm install --frozen-lockfile`.
- Do not bypass pnpm's dependency-verification guard with `--config.verify-deps-before-run=false`; fix the underlying workspace state or report the blocker instead.
- Do not use `as any` or lazy `as unknown` / `as unknown as T` casts to silence TypeScript errors; prove the type with control flow or helpers, or isolate the boundary with a narrow documented assertion.
- Historical plan docs under `agent-docs/exec-plans/completed/` are immutable snapshots.
- Do not invent compatibility, deployment, or runtime requirements. Document them in repo docs and scripts in the same change that introduces them.
- Before landing new persisted state, classify it explicitly as canonical `vault/**`, durable local operational state under `.runtime/operations/**`, rebuildable local projection under `.runtime/projections/**`, or ephemeral cache/tmp state. Durable JSON state needs an explicit schema/schemaVersion seam, and durable SQLite state needs an explicit `user_version` migration seam.
- If a datum is user-facing, queryable, or something future product features will build on, it must not land in assistant runtime or other local operational state first. Put it in canonical `vault/**`, or in explicit `derived/**` materializations when it is derived rather than authoritative. `vault/.runtime/operations/assistant/**` is execution residue only.

## Workflow Defaults

- Repo code/docs/test/config work uses `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`; vault-only data work does not by default.
- Review-only repo inspection with no file edits does not require default test or typecheck runs; use direct file readback unless the user asks for runtime proof or the review question cannot be resolved statically.
- Preserve unrelated worktree edits. Do not overwrite, discard, or revert work you did not make.
- Use an execution plan for multi-file or high-risk work. Narrow supplied-patch landings may stay ledger-only when they remain bounded and single-turn.
- If architecture-significant behavior changes, update `ARCHITECTURE.md` and the matching durable docs.
- Required completion-workflow audit subagent passes are part of the repo workflow once the user has asked for repo work. That standing repo instruction is already sufficient permission to spawn those required audit subagents, so do not wait for or ask for an extra explicit "use subagents" message.
- Completion-workflow audit subagents default to one pass per task. Re-run at most one additional audit pass only when the first pass leads to a large or high-risk follow-up diff; otherwise finish locally without spawning another workflow audit subagent.
- Same-turn task completion counts as acceptance unless the user says `review first` or `do not commit`.
- If repo files changed and the user did not say `review first` or `do not commit`, create a scoped commit before final handoff.
- Do not skip that commit because the worktree is dirty; commit only the exact touched paths with `scripts/finish-task` or `scripts/committer`.
- If a touched file already had edits, that is still not a reason to skip the scoped commit; note it explicitly in handoff.
- If required checks fail for a credibly unrelated pre-existing reason, commit the exact touched paths anyway and hand off with the failing command, failing target, and why your diff did not cause it.
- `scripts/finish-task` is the higher-level helper for plan-bearing tasks: it requires the active plan path, resolves the file/directory paths you pass into exact changed file paths, closes that plan, then shells out to `scripts/committer` with the completed-plan artifact plus those resolved paths.
- Use `scripts/finish-task` only while the plan still exists under `agent-docs/exec-plans/active/`; if the plan was already closed/moved, or the task was ledger-only, use `scripts/committer` directly.
- `scripts/committer` is the path-scoped dirty-tree-safe commit tool; prefer it over hand-rolled `git commit` flows when unrelated staged or unstaged work is present.
- Update `agent-docs/index.md` when durable docs are added, removed, moved, or materially repurposed.

## Notes

- This file should stay a compact router, not a policy manual. Target roughly 100 lines or less and keep the structure limited to: purpose, precedence, read-first docs, task router, non-negotiables, workflow defaults, and notes.
- Keep this file short and route-oriented. Move durable detail into `agent-docs/`.
