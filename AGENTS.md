# AGENTS.md

## Default To Deletion And Simplicity

Default to deletion and radical simplicity. Before adding code, abstractions,
dependencies, services, configuration, state, or process, first challenge the
requirement itself: is this solving a real, current problem, or are we
preserving complexity because it already exists or might be useful later?
Prefer the smallest architecture that satisfies the actual requirement with
the fewest moving parts, concepts, branches, and hidden behaviors. Delete
obsolete code aggressively; collapse unnecessary layers; inline premature
abstractions; remove speculative generality; and make data flow obvious. Only
after the system has been reduced to what truly must exist should you
simplify, optimize, speed up, or automate it. Add complexity back only when a
failing test, measured bottleneck, security requirement, or concrete product
need proves that the simpler design is insufficient.

## Purpose

This file is the compact routing map for agent work in this repository.
Durable guidance lives in `agent-docs/`; keep detailed policy there instead of expanding this file.

## Precedence

1. Explicit user instruction in the current chat turn.
2. `Hard Rules (Non-Negotiable)` in this file.
3. `agent-docs/operations/agent-workflow-routing.md`.
4. Other detailed docs under `agent-docs/**`.

If instructions still conflict after applying this order, ask the user before acting.

## Read First

Always read these before repo code/docs/test/config work:

1. `agent-docs/index.md`
2. `ARCHITECTURE.md`
3. `docs/contracts/00-invariants.md`
4. `agent-docs/references/repo-scope.md`
5. `agent-docs/operations/agent-workflow-routing.md`
6. `agent-docs/PRODUCT_SENSE.md`
7. `agent-docs/PRODUCT_CONSTITUTION.md`

## Task Router

| If the task is about... | Also read | Notes |
| --- | --- | --- |
| Review-only inspection with no planned file edits | `agent-docs/operations/verification-and-runtime.md` | No repo ledger or repo-wide checks by default. Add runtime proof only when requested or when static inspection leaves a material gap. |
| Docs or process only | `agent-docs/operations/verification-and-runtime.md` | Follow the docs/process task class in the workflow router. |
| Repo code, tests, or config | `agent-docs/operations/completion-workflow.md`, `agent-docs/operations/verification-and-runtime.md` | Use the workflow router for task class, ledger/plan needs, audits, verification, and commit path. |
| User-facing frontend/UI work in `apps/web` | `agent-docs/FRONTEND.md` | The completion workflow controls required frontend review. |
| Auth, secrets, trust boundaries, or external runtime surfaces | `agent-docs/SECURITY.md` | Treat as higher risk by default. |
| Retries, queues, cron, concurrency, or failure handling | `agent-docs/RELIABILITY.md` | Capture direct proof for operational changes. |
| Cloudflare infrastructure, Workers, Durable Objects, R2, or deploy/runtime platform APIs | `agent-docs/SECURITY.md`, `agent-docs/RELIABILITY.md`, relevant official Cloudflare docs | Read Cloudflare docs thoroughly before designing; prefer the simplest canonical Cloudflare API or feature, and assume the platform likely already provides the needed primitive before rolling bespoke infrastructure. |
| Test selection or verification changes | `agent-docs/references/testing-ci-map.md` | Keep test coverage and doc claims aligned. |
| Product behavior or UX tradeoffs | `agent-docs/PRODUCT_SENSE.md`, `agent-docs/PRODUCT_CONSTITUTION.md` | Prefer repo-local durable specs over chat memory. |
| Marketing, positioning, copy, or experiment library work | `agent-docs/product-marketing-context.md` | Use the repo marketing context for positioning, differentiation, customer language, and brand voice. |
| Health Commons content or experiment library structure | `agent-docs/product-specs/health-commons.md` | Generated catalog artifacts are ignored build outputs; commit authored content and intentional generator/schema/test changes only. |
| Dependency changes | `agent-docs/SECURITY.md` | Follow the dependency supply-chain rules before handoff. |

## Hard Rules (Non-Negotiable)

- Never expose secrets, raw credentials, private keys, tokens, full `Authorization` headers, or downloaded secret values in commits, code, docs, generated files, comments, logs, examples, quoted output, or external artifacts. Keep legal names, local account usernames, and home-directory paths out of committed or published artifacts; for local debugging, prefer repo-relative paths and do not let identifier redaction block root-cause proof.
- Treat `.env` and `.env*` as sensitive. Never print, commit, or otherwise expose their contents.
- Do not pull remote environment variables into local files for inspection. Use provider CLI list/status commands that show names/scopes only, and ask before any operation that would download secret values.
- When writing assistant/provider prompts, avoid automated-outreach framing: acquisition/signup language, `new user` labels, delivery/notification wording, and imperative exact-send phrasing in the same prompt. Prefer in-chat, user-facing task framing.
- Import sibling workspace packages by package name through declared public entrypoints only; do not reach into another package's `src/` or `dist/`.
- Keep workspace package dependencies one-way and acyclic. Put shared runtime/domain logic in a lower owning package instead of cross-importing sibling internals or using sibling-to-sibling re-exports.
- Compatibility shims must be temporary and legacy-facing only. Keep them on the old path pointing at the new owner, and never make the owning package depend on the legacy package for the same surface.
- Do not reintroduce custom Turbopack loader-based rewriting for repo-local workspace sources.
- Dependency changes are high-risk: use public-registry specs, update the committed lockfile in the same change, keep pnpm supply-chain exceptions narrow, and do not bypass pnpm dependency verification.
- Do not use `as any` or lazy `as unknown` / `as unknown as T` casts to silence TypeScript errors. Prove the type with control flow/helpers, or isolate the boundary with a narrow documented assertion.
- Do not paper over bugs or architectural friction with speculative complexity. Identify the root cause first and choose the simplest durable correction that preserves system invariants.
- When investigating a bug, do not anchor on hunches, guesses, likely causes, or pattern matches. Treat hypotheses only as temporary questions to test. Exhaust the evidence path before fixing: inspect the relevant code, data, logs, runtime state, and recent changes deeply enough to identify the underlying architectural/root cause, then prove that cause with static analysis, code-path evidence, a focused reproduction, or a failing test before choosing a fix. If current observability is insufficient, add targeted diagnostic logging or probes that are secret-safe and concrete enough to reveal the cause; do not substitute assumption, bandaid fixes, or broad rewrites for understanding.
- Do not invent compatibility, deployment, or runtime requirements. Document them in the matching durable docs and scripts in the same change that introduces them.
- Do not weaken production runtime, auth, or env invariants for tests, smoke checks, or builds. Fix harnesses with test-only config or wrappers instead.
- Follow the persisted-state placement gate in `agent-docs/operations/agent-workflow-routing.md` and `ARCHITECTURE.md`; user-facing or queryable product truth must not start in assistant runtime state.
- Historical plan docs under `agent-docs/exec-plans/completed/` are immutable snapshots.

## Workflow Defaults

- Use `agent-docs/operations/agent-workflow-routing.md` to classify task type, ledger/plan needs, audit requirements, verification, and commit path.
- Repo code/docs/test/config work uses `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`; vault-only data work does not by default. Preserve unrelated ledger or working-tree edits.
- Preserve unrelated working-tree edits in the current checkout. Do not overwrite, discard, or revert work you did not make.
- `apply_patch` targets the current session checkout, not the last shell `workdir`. When editing a separate worktree, use absolute paths in patch headers or verify the target checkout before patching.
- Default most non-trivial repo code/test/config changes to a separate git worktree on a task branch, then open a PR after the normal scoped commit. Use the current checkout directly for review-only work, vault-only data work, prompt-primary changes, text-only docs/process edits, minor copy/static-content changes, and other tiny low-risk edits where isolation would add more process than value.
- Do not create or switch branches in the current checkout as a dirty-worktree workaround. When isolation is needed, use a separate worktree/branch; if unrelated dirty work blocks safe setup or a scoped commit, stop and report the blocker.
- Before pushing `main` or another shared default branch, fetch and reconcile with ordinary Git history operations (`pull --rebase`, fast-forward, or a normal merge) when possible. Do not manufacture sibling-history merge commits with low-level commands such as `git commit-tree`/`git update-ref` just to work around a dirty checkout; if unrelated dirty work blocks a safe pull or rebase, stop and report the blocker.
- Use `agent-docs/operations/completion-workflow.md` for mandatory completion audits. Required local Codex audit subagents are repo-policy pre-authorized; run them when the routed task class requires them.
- Always run the verification required by `agent-docs/operations/verification-and-runtime.md` unless the user explicitly asks not to. If a required check is blocked by a credibly unrelated pre-existing failure, report the command, failing target, and why the current diff did not cause it.
- Same-turn task completion counts as acceptance unless the user says `review first` or `do not commit`.
- If repo files changed and the user did not say `review first` or `do not commit`, create a scoped commit before handoff. Use `scripts/finish-task` for the final commit of active-plan work so the matching ledger row is removed and the plan is archived; use `scripts/committer` only when no active plan is involved.
- If a plan-bearing task is done or abandoned but a safe scoped commit is blocked by overlapping dirty work, clear the exact ledger row and archive the plan with `scripts/close-exec-plan.sh`.
- Document architecture-significant changes in the matching durable docs, and update `agent-docs/index.md` when durable docs are added, removed, moved, or materially repurposed.
- If a completed task could break or degrade production when Vercel (`apps/web`) and Cloudflare (`apps/cloudflare`) deploy out of sync, add a final-response section labeled `DEPLOYMENT CONCERNS:` with the recommended safe deployment order, required tandem deploy or compatibility window, and any post-deploy checks.

## Notes

- When debugging Codex CLI issues, check for a sibling checkout at `../codex`; if it is missing, clone the Codex CLI repo there so future debugging can reuse that location.
- Before running `pnpm dev` from a secondary git worktree or branch-isolated checkout, read `agent-docs/operations/hosted-local-worktree-dev.md` and isolate the ports, database, local hosted crypto state, Wrangler state, Next dist dir, optional MinIO data, and webhook tunnel target together.
- Keep this file short and route-oriented. Move durable detail into `agent-docs/`.
- DBHub MCP is only for production database inspection. For local database debugging, use the explicit local `DATABASE_URL` or repo-local tooling instead. DBHub JSON rendering is unsafe evidence for PostgreSQL `timestamp without time zone`; format those columns in SQL before interpreting times.
- Target roughly 100 lines or fewer and preserve these sections: purpose, precedence, read-first docs, task router, non-negotiables, workflow defaults, and notes.
