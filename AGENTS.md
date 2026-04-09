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

| If the task is about...                                       | Also read                                                                                           | Notes                                                                                                                               |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Review-only inspection with no planned file edits             | `agent-docs/operations/verification-and-runtime.md`                                                 | No repo ledger or repo-wide checks by default. Only add runtime proof when the user asks for it or static inspection is not enough. |
| Docs or process only                                          | `agent-docs/operations/verification-and-runtime.md`                                                 | No audit subagents by default.                                                                                                      |
| Repo code, tests, or config                                   | `agent-docs/operations/completion-workflow.md`, `agent-docs/operations/verification-and-runtime.md` | Follow the task classes in the workflow-routing doc. Spawn required audit subagents when that workflow calls for them.              |
| Auth, secrets, trust boundaries, or external runtime surfaces | `agent-docs/SECURITY.md`                                                                            | Treat as higher risk by default.                                                                                                    |
| Retries, queues, cron, concurrency, or failure handling       | `agent-docs/RELIABILITY.md`                                                                         | Capture direct proof for operational changes.                                                                                       |
| Test selection or verification changes                        | `agent-docs/references/testing-ci-map.md`                                                           | Keep test coverage and doc claims aligned.                                                                                          |
| Product behavior or UX tradeoffs                              | `agent-docs/PRODUCT_SENSE.md`, `agent-docs/PRODUCT_CONSTITUTION.md`                                 | Prefer repo-local durable specs over chat memory.                                                                                   |
| Marketing, positioning, copy, or experiment library work      | `agent-docs/product-marketing-context.md`                                                           | Use the repo marketing context for positioning, differentiation, customer language, and brand voice.                                |

## Hard Rules (Non-Negotiable)

- Treat `.env` and `.env*` as sensitive. Never print, commit, or otherwise expose their contents.
- Never print or commit secrets, raw credentials, or full `Authorization` headers.
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
- Follow the persisted-state placement gate in the workflow docs and `ARCHITECTURE.md`; do not put user-facing or queryable product truth in assistant runtime first.

## Workflow Defaults

- Repo code/docs/test/config work uses `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`; vault-only data work does not by default.
- Preserve unrelated worktree edits. Do not overwrite, discard, or revert work you did not make.
- If verification or build commands introduce tracked edits outside the intended task scope, check `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` before removing or reverting them. If another active row plausibly owns those files, stop and coordinate instead of cleaning them up unilaterally.
- Document architecture-significant changes in the matching durable docs.
- Use the completion and verification docs for detailed workflow and command selection.
- Required completion-workflow audit passes are pre-authorized by repo policy. When a repo task reaches that workflow, run the required coverage and final-review passes without waiting for or asking for an extra explicit "use subagents" instruction.
- Same-turn task completion counts as acceptance unless the user says `review first` or `do not commit`.
- If repo files changed and the user did not say `review first` or `do not commit`, create a scoped commit before handoff. Use `scripts/finish-task` while the active plan still exists under `agent-docs/exec-plans/active/`; otherwise use `scripts/committer`. In dirty trees, commit only the exact touched paths and note overlapping pre-existing edits in handoff.
- If a required check fails for a credibly unrelated pre-existing reason, still commit the exact touched paths and hand off with the failing command, failing target, and why the current diff did not cause it.
- Update `agent-docs/index.md` when durable docs are added, removed, moved, or materially repurposed.

## Notes

- This file should stay a compact router, not a policy manual. Target roughly 100 lines or less and keep the structure limited to: purpose, precedence, read-first docs, task router, non-negotiables, workflow defaults, and notes.
- Keep this file short and route-oriented. Move durable detail into `agent-docs/`.
