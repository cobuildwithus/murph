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
| Product behavior or UX tradeoffs | `agent-docs/PRODUCT_SENSE.md`, `agent-docs/PRODUCT_CONSTITUTION.md` | Prefer repo-local durable specs over chat memory. |
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
- Before implementing any frontend change, think through the UX and choose the simplest complete implementation that preserves required behavior, states, accessibility, responsiveness, and recovery. The bar is a result Steve Jobs would be proud of.
- Review/audit findings, including Codex deep-review findings, do not override the repo's simplicity and ownership rules. Reject or redesign fixes that add broad state, queues, managers, lifecycle machinery, or abstractions when deletion, reordering, an existing owner boundary, or one source-of-truth derivation can preserve the invariant.
- Do not fix safety, reliability, privacy, auth, or review findings by disabling, silently dropping, or degrading existing user-critical flows such as onboarding, welcome delivery, current-inbound replies, billing/access, auth, sync, or privacy/safety controls; follow `docs/contracts/00-invariants.md` § Product-Critical Flow Preservation.
- When investigating a bug, do not anchor on hunches, guesses, likely causes, or pattern matches. Treat hypotheses only as temporary questions to test. Exhaust the evidence path before fixing: inspect the relevant code, data, logs, runtime state, and recent changes deeply enough to identify the underlying architectural/root cause, then prove that cause with static analysis, code-path evidence, a focused reproduction, or a failing test before choosing a fix. If current observability is insufficient, add targeted diagnostic logging or probes that are secret-safe and concrete enough to reveal the cause; do not substitute assumption, bandaid fixes, or broad rewrites for understanding.
- Do not invent compatibility, deployment, or runtime requirements. Document them in the matching durable docs and scripts in the same change that introduces them. A hosted deploy environment change is complete only when the public deploy contract, the private `murph-cloud` workflow mapping, its owning GitHub Environment, and post-deploy live binding proof remain aligned; configuration in one repository is not deployment evidence.
- Do not weaken production runtime, auth, or env invariants for tests, smoke checks, or builds. Fix harnesses with test-only config or wrappers instead.
- Follow the persisted-state placement gate in `agent-docs/operations/agent-workflow-routing.md` and `ARCHITECTURE.md`; user-facing or queryable product truth must not start in assistant runtime state.
- Historical plan docs under `agent-docs/exec-plans/completed/` are immutable,
  non-operative snapshots. Never use them as current implementation, deployment,
  rollback, or incident instructions; the live owner docs indexed in
  `agent-docs/index.md` prevail.

## Workflow Defaults

- Apply `agent-docs/operations/agent-workflow-routing.md` § Agent Work Contract for outcomes, evidence, action authority, tool use, progress updates, validation, and stopping.
- Use `agent-docs/operations/agent-workflow-routing.md` to classify task type, plan needs, audit requirements, verification, and commit path.
- Preserve unrelated working-tree edits in the current checkout. Do not overwrite, discard, or revert work you did not make.
- `apply_patch` targets the current session checkout, not the last shell `workdir`. When editing a separate worktree, use absolute paths in patch headers or verify the target checkout before patching.
- Default most non-trivial repo code/test/config changes to a separate git worktree on a task branch, then open a PR after the normal scoped commit. Use the current checkout directly for review-only work, vault-only data work, text-only docs/process edits, and tiny copy/static-content changes that qualify for the completion fast path. Prompt-primary, frontend, and coverage-bearing repo changes use the worktree/PR lane so the preliminary specialist ReviewGPT pass can inspect an exact pushed head.
- Create task worktrees only through `scripts/create-worktree`; never bypass its ratcheted worktree-count and free-space guard with raw `git worktree add`. An unauthorized checkout fails its own commit and remains visible to the primary checkout's global audit, but it must not block commits or sanctioned worktree creation in authorized current-version sibling checkouts. Both primary/task version orders remain argument-compatible, but a preceding-version creator stays globally fail-closed around a raw sibling until it advances; no guard may publish authorization for the raw checkout. Large data or research work must use `--data-research <reason>`, which locks that checkout with a visible `data/research:` reason. After a task PR is confirmed merged or closed, retire its clean inactive worktree from another checkout with `scripts/retire-worktree <path>`; the task is not complete until that succeeds or its fail-closed blocker is reported. Use `--inactive-no-pr` only when the current user explicitly authorizes cleanup of clean inactive branches with no open PR.
- Do not create standalone Murph clones or standalone pnpm stores in temp directories; use the ordinary shared pnpm store. Normal Vitest temp files, including private or ignored data/research test lanes, must stay under the shared marked run root; persistent downloaded datasets belong in explicit data/research roots instead of `os.tmpdir()`. Interrupted marked roots use `scripts/cleanup-test-temp.ts`, which is dry-run by default. Follow `agent-docs/operations/local-storage-lifecycle.md` for fail-closed exceptions and build-output cleanup.
- When opening or updating a PR, the body must follow `agent-docs/operations/completion-workflow.md` § PR Description: why it exists, the user-visible goal and applicable UX, invariants, a concrete architecture-and-reuse summary, and a compact added/deleted line breakdown by source, tests, docs, config/tooling, and generated/other.
- All shipped user-facing `apps/web` UI must be viewable in the design catalog. Reuse an existing component from `/design?tab=components` before adding a near-duplicate, and build new UI as reusable components rather than one-off markup. Add every new component to `/design?tab=components`, and give each new screen, flow, or multi-component surface its own `/design?tab=sections` study. When a production screen and its study would otherwise duplicate copy or branching, extract the shared presentation into one component both render, so the catalog cannot drift from production. Studies render the real component against synthetic props only: no live data, no real requests, and interactive controls held `inert`. `scripts/check-frontend-design-proof.mjs` enforces the catalog touch and the PR `Design proof` block.
- Do not create or switch branches in the current checkout as a dirty-worktree workaround. When isolation is needed, use a separate worktree/branch; if unrelated dirty work blocks safe setup or a scoped commit, stop and report the blocker.
- Before pushing `main` or another shared default branch, fetch and reconcile with ordinary Git history operations (`pull --rebase`, fast-forward, or a normal merge) when possible, then run `pnpm verify:acceptance` against that exact candidate before the push. Do not manufacture sibling-history merge commits with low-level commands such as `git commit-tree`/`git update-ref` just to work around a dirty checkout; if unrelated dirty work blocks a safe pull or rebase, stop and report the blocker.
- Use `agent-docs/operations/completion-workflow.md` for mandatory completion audits. One preliminary `completion-specialists` ReviewGPT pass replaces the former local product-experience-review, prompt-review, frontend-review, and coverage-write subagents and applies the relevant lenses together; the parent must inspect and verify any returned coverage patch before applying it.
- When both ReviewGPT stages apply, the preliminary specialist pass and final round 1 may start concurrently against the same exact pushed candidate head after focused local proof and the parent's candidate review. They remain independent: preliminary findings do not advance the final baseline, the preliminary pass is not rerun after substantive remediation, and any accepted finding from either stage must be resolved before the parent's final review and completion. Local `deep-review` and the final PR-lane ReviewGPT gate are mutually exclusive. Final round 1 is always a full-patch audit. On later rounds, sensitive, undeclared, or large current PRs get a fresh full-patch audit by default; only explicitly routine PRs below both size cutoffs reuse the current thread with the remediation delta and directly affected paths. Run ReviewGPT concurrently with CI. Do not rerun merely because `main`/the base advanced, an isolated regression test or explanatory doc changed, or a clean merge/rebase updated only base history; rerun CI instead. Follow `agent-docs/operations/pr-reviewgpt-loop.md` for exact-head packaging, specialist-patch handling, immutable final-gate baselines, anomaly retrospectives, and retry counting.
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
