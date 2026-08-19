# AGENTS.md

## Default To Deletion And Simplicity

Prefer deletion and the smallest maintainable architecture that satisfies the
current requirement. Add a dependency, abstraction, service, state owner, or
process only when concrete product, security, test, or measured performance
evidence proves the simpler design insufficient.

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
4. `agent-docs/ARCHITECTURE_GUIDANCE.md`
5. `agent-docs/references/repo-scope.md`
6. `agent-docs/operations/agent-workflow-routing.md`
7. `agent-docs/PRODUCT_SENSE.md`
8. `agent-docs/PRODUCT_CONSTITUTION.md`

## Task Router

| If the task is about... | Also read | Notes |
| --- | --- | --- |
| Review-only inspection with no planned file edits | `agent-docs/operations/verification-and-runtime.md` | No repo-wide checks by default. Add runtime proof only when requested or when static inspection leaves a material gap. |
| Docs or process only | `agent-docs/operations/verification-and-runtime.md` | Follow the docs/process task class in the workflow router. |
| Repo code, tests, or config | `agent-docs/operations/completion-workflow.md`, `agent-docs/operations/verification-and-runtime.md` | Use the workflow router for task class, plan needs, audits, verification, and commit path. |
| User-facing frontend/UI work in `apps/web` | `agent-docs/FRONTEND.md` | Follow the normal task-class implementation route; the completion workflow still controls browser proof and required frontend review. |
| Auth, secrets, trust boundaries, or external runtime surfaces | `agent-docs/SECURITY.md` | Treat as higher risk by default. |
| Retries, queues, cron, concurrency, or failure handling | `agent-docs/RELIABILITY.md` | Capture direct proof for operational changes. |
| Cloudflare infrastructure, Workers, Durable Objects, R2, or deploy/runtime platform APIs | `agent-docs/SECURITY.md`, `agent-docs/RELIABILITY.md`, relevant official Cloudflare docs | Read Cloudflare docs thoroughly before designing; prefer the simplest canonical Cloudflare API or feature, and assume the platform likely already provides the needed primitive before rolling bespoke infrastructure. |
| Test selection or verification changes | `agent-docs/references/testing-ci-map.md` | Keep test coverage and doc claims aligned. |
| Product behavior or UX tradeoffs | `agent-docs/PRODUCT_SENSE.md`, `agent-docs/PRODUCT_CONSTITUTION.md`, `agent-docs/operations/product-ux.md` | Plan affected people before code and walk their real experience after code. |
| iMessage/SMS replies, outbound message copy, reminders, notifications, line health, or phone-number messaging behavior | `agent-docs/operations/imessage-deliverability.md` | Design for reciprocal conversations, safe pacing, link hygiene, cold-contact protection, and fail-closed line health. |
| Marketing, positioning, copy, or experiment library work | `agent-docs/product-marketing-context.md` | Use the repo marketing context for positioning, differentiation, customer language, and brand voice. |
| Health Commons content or experiment library structure | `agent-docs/product-specs/health-commons.md` | Generated catalog artifacts are ignored build outputs; commit authored content and intentional generator/schema/test changes only. |
| Dependency changes | `agent-docs/SECURITY.md` | Follow the dependency supply-chain rules before handoff. |

## Hard Rules (Non-Negotiable)

- Never expose secrets, raw credentials, private keys, tokens, full `Authorization` headers, or downloaded secret values in commits, code, docs, generated files, comments, logs, examples, quoted output, or external artifacts. Keep legal names, local account usernames, and home-directory paths out of committed or published artifacts; for local debugging, prefer repo-relative paths and do not let identifier redaction block root-cause proof.
- Treat screenshots, chat transcripts, and user feedback as confidential evidence, not repository-ready source material. Never copy, closely paraphrase, or hardcode them, including names, handles, images, identifying details, distinctive wording, or exact scenarios, into system prompts, tests, fixtures, snapshots, evals, docs, comments, PR descriptions, or any source that may become public.
- Treat `.env` and `.env*` as sensitive. Never print, commit, or otherwise expose their contents.
- Do not pull remote environment variables into local files for inspection. Use provider CLI list/status commands that show names/scopes only, and ask before any operation that would download secret values.
- When writing assistant/provider prompts, outbound iMessage/SMS copy, or phone-number messaging behavior, read `agent-docs/operations/imessage-deliverability.md`; avoid automated-outreach framing: acquisition/signup language, `new user` labels, delivery/notification wording, and imperative exact-send phrasing in the same prompt. Prefer in-chat, user-facing task framing.
- Import sibling workspace packages by package name through declared public entrypoints only; do not reach into another package's `src/` or `dist/`.
- Keep workspace package dependencies one-way and acyclic. Put shared runtime/domain logic in a lower owning package instead of cross-importing sibling internals or using sibling-to-sibling re-exports.
- Compatibility shims must be temporary and legacy-facing only. Keep them on the old path pointing at the new owner, and never make the owning package depend on the legacy package for the same surface.
- Do not reintroduce custom Turbopack loader-based rewriting for repo-local workspace sources.
- Dependency changes are high-risk: use public-registry specs, update the committed lockfile in the same change, keep pnpm supply-chain exceptions narrow, and do not bypass pnpm dependency verification.
- Do not use `as any` or lazy `as unknown` / `as unknown as T` casts to silence TypeScript errors. Prove the type with control flow/helpers, or isolate the boundary with a narrow documented assertion.
- Do not paper over bugs or architectural friction with speculative complexity. Identify the root cause first and choose the simplest durable correction that preserves system invariants.
- Before adding or changing database-touching collection work, apply `docs/contracts/00-invariants.md` § Database Load And Collection Fanout and evaluate its composed peak load at maximum admitted cardinality.
- Before implementing a user-facing change, follow `agent-docs/operations/product-ux.md`. Choose the smallest Product UX effort, plan every materially different affected person before code, and replay those people after code. Use the dimensions in that document to select distinct journeys, not a required Cartesian matrix.
- Before implementing any frontend change, think through the UX and choose the simplest complete implementation that preserves required behavior, states, accessibility, responsiveness, and recovery. The bar is a result Steve Jobs would be proud of.
- Review/audit findings, including Codex deep-review findings, do not override the repo's simplicity and ownership rules. Reject or redesign fixes that add broad state, queues, managers, lifecycle machinery, or abstractions when deletion, reordering, an existing owner boundary, or one source-of-truth derivation can preserve the invariant.
- Do not fix safety, reliability, privacy, auth, or review findings by disabling, silently dropping, or degrading existing user-critical flows such as onboarding, welcome delivery, current-inbound replies, billing/access, auth, sync, or privacy/safety controls; follow `docs/contracts/00-invariants.md` § Product-Critical Flow Preservation.
- When investigating a bug, do not anchor on hunches, guesses, likely causes, or pattern matches. Treat hypotheses only as temporary questions to test. Exhaust the evidence path before fixing: inspect the relevant code, data, logs, runtime state, and recent changes deeply enough to identify the underlying architectural/root cause, then prove that cause with static analysis, code-path evidence, a focused reproduction, or a failing test before choosing a fix. If current observability is insufficient, add targeted diagnostic logging or probes that are secret-safe and concrete enough to reveal the cause; do not substitute assumption, bandaid fixes, or broad rewrites for understanding.
- Do not invent compatibility, deployment, or runtime requirements. Document them in the matching durable docs and scripts in the same change that introduces them. A hosted deploy environment change is complete only when the public deploy contract, the private `murph-cloud` workflow mapping, its owning GitHub Environment, and post-deploy live binding proof remain aligned; configuration in one repository is not deployment evidence.
- Do not weaken production runtime, auth, or env invariants for tests, smoke checks, or builds. Fix harnesses with test-only config or wrappers instead.
- Follow the persisted-state placement gate in `agent-docs/operations/agent-workflow-routing.md` and `ARCHITECTURE.md`; user-facing or queryable product truth must not start in assistant runtime state.
- Every open database transaction pins one pooled connection, so keep transactions short, bounded, and database-only. Resolve provider/network calls, user input, sleeps, heavy computation, and other unbounded work before opening one; once open, perform only the minimum reads and writes needed for the invariant, apply supported timeouts, avoid concurrent per-item or nested transactions, and release the connection promptly. Follow `docs/contracts/00-invariants.md` § Database Load And Collection Fanout.
- Historical plan docs under `agent-docs/exec-plans/completed/` are immutable,
  non-operative snapshots. Never use them as current implementation, deployment,
  rollback, or incident instructions; the live owner docs indexed in
  `agent-docs/index.md` prevail.

## Workflow Defaults

- Apply `agent-docs/operations/agent-workflow-routing.md` § Agent Work Contract for outcomes, evidence, action authority, tool use, progress updates, validation, and stopping.
- For every edit-authorized repository task, follow `agent-docs/operations/agent-workflow-routing.md` § Developer Friction Logging and `.agents/skills/frog/SKILL.md`; inspect existing Frog entries before a workaround, log qualifying new repository friction, and commit each created entry with the task.
- Use `agent-docs/operations/agent-workflow-routing.md` to classify task type, plan needs, audit requirements, verification, and commit path.
- Preserve unrelated working-tree edits in the current checkout. Do not overwrite, discard, or revert work you did not make.
- Before starting or resuming work on an existing PR, prove exclusive session ownership from the PR head, branch/worktree state, and any active handoff or coordination record. If another agent or session owns it, ownership is ambiguous, or the head moves unexpectedly, stop before editing, committing, or pushing and report the collision; continue only after an explicit handoff. A conflict-free fast-forward is not permission to co-author the same live branch.
- `apply_patch` targets the current session checkout, not the last shell `workdir`. When editing a separate worktree, use absolute paths in patch headers or verify the target checkout before patching.
- Default most non-trivial repo code/test/config changes to a separate git worktree on a task branch, then open a PR after the normal scoped commit. Use the current checkout directly for review-only work, vault-only data work, text-only docs/process edits, and tiny copy/static-content changes that qualify for the completion fast path. Prompt-primary, frontend, and coverage-bearing repo changes use the worktree/PR lane so the preliminary specialist ReviewGPT pass can inspect an exact pushed head.
- Create task worktrees only through `scripts/create-worktree`; never bypass its ratcheted worktree-count and free-space guard with raw `git worktree add`. An unauthorized checkout fails its own commit and remains visible to the primary checkout's global audit, but it must not block commits or sanctioned worktree creation in authorized current-version sibling checkouts after the primary guard advances. Primary/task version orders remain argument-compatible, but every preceding-version primary entrypoint stays globally fail-closed around clean raw state until the primary advances; no guard may publish authorization for the raw checkout. If the rejected intermediate authorization-plus-isolation state exists, advance the primary first so its current guard retires authorization first under the existing guard lock; task-local guards never mutate that state. Large data or research work must use `--data-research <reason>`, which locks that checkout with a visible `data/research:` reason. After a task PR is confirmed merged or closed, retire its clean inactive worktree from another checkout with `scripts/retire-worktree <path>`; the task is not complete until that succeeds or its fail-closed blocker is reported. Use `--inactive-no-pr` only when the current user explicitly authorizes cleanup of clean inactive branches with no open PR.
- Do not create standalone Murph clones or standalone pnpm stores in temp directories; use the ordinary shared pnpm store. Normal Vitest temp files, including private or ignored data/research test lanes, must stay under the shared marked run root; persistent downloaded datasets belong in explicit data/research roots instead of `os.tmpdir()`. Interrupted marked roots use `scripts/cleanup-test-temp.ts`, which is dry-run by default. Follow `agent-docs/operations/local-storage-lifecycle.md` for fail-closed exceptions and build-output cleanup.
- When opening or updating a PR, follow `agent-docs/operations/completion-workflow.md` § PR Description. Keep the body short: outcome, Product UX result, direct evidence, changelog, and only the risk details that apply.
- Reuse an existing component from `/design?tab=components` before adding a near-duplicate, and add new shared components there. Use `/screenshots` only for difficult or reusable presentation states. Screenshot studies render the real production component with synthetic props only: no live data, no real requests, and interactive controls held `inert`. A user-facing UI diff does not need a catalog change by default; evidence must match the changed claim.
- Do not create or switch branches in the current checkout as a dirty-worktree workaround. When isolation is needed, use a separate worktree/branch; if unrelated dirty work blocks safe setup or a scoped commit, stop and report the blocker.
- Before pushing `main` or another shared default branch, fetch and reconcile with ordinary Git history operations (`pull --rebase`, fast-forward, or a normal merge) when possible, then run `pnpm verify:acceptance` once for that direct-push attempt. If the remote advances while acceptance runs, the unchanged accepted patch gets at most one post-acceptance rebase: require no conflicts, prove the patch is unchanged, inspect the intervening base diff, and rerun affected focused checks, but do not restart full acceptance solely for base movement. Push immediately; if that push is rejected because the remote advanced again, report `moving-base race` and stop. The budget remains consumed until push or handoff; another agent turn does not reset it. Do not manufacture sibling-history merge commits with low-level commands such as `git commit-tree`/`git update-ref` just to work around a dirty checkout; if unrelated dirty work blocks a safe pull or rebase, stop and report the blocker.
- Use `agent-docs/operations/completion-workflow.md` for mandatory completion audits. One preliminary `completion-specialists` ReviewGPT pass applies the relevant Product UX, prompt, frontend, and coverage lenses together; the parent must inspect and verify any returned coverage patch before applying it.
- Give every long-running ReviewGPT job one completion owner. Prefer the normal tool-owned `--wait` capture; when the review must outlive the active turn, arm detached `cobuild-review-gpt thread wake` so its watcher resumes the owning Codex session only after completion. Do not spend active agent turns repeatedly status-polling ReviewGPT. If completion notification is unavailable and a manual check is necessary, leave at least five minutes between checks. For an intentional implementation handoff, pass `--poll-interval 5m` and, unless the caller already supplied an explicit per-run bound, `--poll-timeout 240m`; preserve explicit caller- or user-supplied bounds. The wake timeout remains separate from ReviewGPT response capture, which defaults to 180 minutes. Follow `agent-docs/operations/pr-reviewgpt-loop.md` § Wait And Wake Ownership.
- When both ReviewGPT stages apply, the preliminary specialist pass and final round 1 may start concurrently against the same exact pushed candidate head after focused local proof and the parent's candidate review. They remain independent: preliminary findings do not advance the final baseline, the preliminary pass is not rerun after substantive remediation, and any accepted finding from either stage must be resolved before the parent's final review and completion. Local `deep-review` and the final PR-lane ReviewGPT gate are mutually exclusive. Frontend-only PRs keep their applicable preliminary lenses and UI proof but skip the final cross-cutting gate unless another risk trigger applies. Final round 1 is always a full-patch audit. On later rounds, sensitive, undeclared, or large current PRs get a fresh full-patch audit by default; only explicitly routine PRs below both size cutoffs reuse the current thread with the remediation delta and directly affected paths. Run ReviewGPT concurrently with CI. Do not rerun merely because `main`/the base advanced, an isolated regression test or explanatory doc changed, or a base-only merge/rebase updated the head; bounded manual conflicts remain exempt only when every resolution is inspected and proven to preserve the already-reviewed PR plus current-base behavior without newly authored behavior or contract changes. Green required CI on the PR-authored head plus a clean current-base `git merge-tree --write-tree` proof is sufficient preparation. At an authorized merge boundary, wait only for routed review gates and required GitHub checks. If strict up-to-date checks block the merge, prefer the merge queue; otherwise perform at most one normal base update for the unchanged reviewed patch and let required CI gate it. If the base advances again after that head is green, do not update or restart CI: rerun the current-base merge-tree and use an already-authorized non-refresh merge path, or report `moving-base race` and stop with the PR and worktree active. Follow `agent-docs/operations/pr-reviewgpt-loop.md` for the exact stopping rule, base-only classification, packaging, specialist-patch handling, immutable final-gate baselines, anomaly retrospectives, and retry counting.
- Always run the verification required by `agent-docs/operations/verification-and-runtime.md` unless the user explicitly asks not to. If a required check is blocked by a credibly unrelated pre-existing failure, report the command, failing target, and why the current diff did not cause it.
- For PR-bound work, run the smallest focused local checks and direct proof that exercise the changed behavior; do not require local `pnpm test:diff`, `pnpm test`, `pnpm test:coverage`, or `pnpm verify:acceptance` merely to open or update the PR. Required GitHub Actions on the exact PR head own the broad suite and must be green before completion. If CI fails, inspect that job and reproduce it with the narrowest useful local command, expanding to an umbrella command only when the failure needs broader diagnosis. Canonical remote execution remains available only under the verification guide's rules; never forward `.env`, Vercel development state, or local environment values into a remote lane.
- Same-turn task completion counts as acceptance unless the user says `review first` or `do not commit`.
- If repo files changed and the user did not say `review first` or `do not commit`, create a scoped commit before handoff. Use `scripts/finish-task` for the final commit of active-plan work so the plan is archived; use `scripts/committer` only when no active plan is involved.
- If a plan-bearing task is done or abandoned but a safe scoped commit is blocked by overlapping dirty work, archive the plan with `scripts/close-exec-plan.sh`.
- Document architecture-significant changes in the matching durable docs, and update `agent-docs/index.md` when durable docs are added, removed, moved, or materially repurposed.
- If a completed task could break or degrade production when Vercel (`apps/web`) and Cloudflare (`apps/cloudflare`) deploy out of sync, add a final-response section labeled `DEPLOYMENT CONCERNS:` with the recommended safe deployment order, required tandem deploy or compatibility window, and any post-deploy checks.

## Notes

- When debugging Codex CLI issues, check for a sibling checkout at `../codex`; if it is missing, clone the Codex CLI repo there so future debugging can reuse that location.
- Before running `pnpm dev` from a secondary git worktree or branch-isolated checkout, read `agent-docs/operations/hosted-local-worktree-dev.md` and isolate the ports, database, local hosted crypto state, Wrangler state, Next dist dir, optional MinIO data, and webhook tunnel target together.
- Keep this file short and route-oriented. Move durable detail into `agent-docs/`.
- For local database inspection and debugging in the main checkout, use repo-local PostgreSQL/Prisma tooling with `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/murph_device_sync`. Use `murph_test` only in test/E2E lanes that explicitly select it; secondary worktrees must use their isolated `murph_dev_<slug>` database.
- Target roughly 100 lines or fewer and preserve these sections: purpose, precedence, read-first docs, task router, non-negotiables, workflow defaults, and notes.
