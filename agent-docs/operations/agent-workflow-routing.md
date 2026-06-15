# Agent Workflow Routing

Last verified: 2026-06-12

This doc is the durable workflow map behind `AGENTS.md`.
Use it to classify the task, load only the relevant docs, and choose the right verification, audit, and commit path.

## Always-Read Set

Before repo code/docs/test/config work, read:

1. `agent-docs/index.md`
2. `ARCHITECTURE.md`
3. `docs/contracts/00-invariants.md`
4. `agent-docs/references/repo-scope.md`
5. this file
6. `agent-docs/PRODUCT_SENSE.md`
7. `agent-docs/PRODUCT_CONSTITUTION.md`

Then load only the task-relevant docs listed below.

## Task Classes

| Task class | Typical scope | Also read | Ledger | Plan | Audits | Verification | Commit path |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Vault-only data | Writes stay under `vault/**` | `agent-docs/operations/verification-and-runtime.md` | No | No by default | No by default | Read back touched records and any mutation artifacts | No repo commit unless asked |
| Review-only repo inspection | Repo code/docs/config review, architecture checks, or code review with no file edits planned | `agent-docs/operations/verification-and-runtime.md` | No | No | No by default | No repo-wide commands by default; cite direct file evidence and only run checks when the user asks for runtime proof or static inspection leaves a material gap | No repo commit unless asked |
| Docs/process-only | Repo docs, process docs, plans, agent workflow docs | `agent-docs/operations/verification-and-runtime.md` | Yes | For multi-file, durable-rule, or likely multi-turn work | No by default | Text-only `.md` docs edits/deletions may use the docs-only fast path; other docs/process work still follows the repo baseline or scoped-verification rules in the verification doc | `scripts/finish-task` if plan-bearing, otherwise `scripts/committer` |
| Tiny low-risk repo change | Narrow, single-purpose repo code/test/config change in one subsystem | `agent-docs/operations/completion-workflow.md`, `agent-docs/operations/verification-and-runtime.md` | Yes | Usually optional unless multi-file/high-risk | Mandatory before handoff: for prompt-primary changes, run only `prompt-review` unless non-prompt code independently triggers another pass; otherwise run `security-privacy-review` when the change materially touches auth/session behavior, secrets, payments, external ingress/egress, public APIs/routes, trust boundaries, or persisted/uploaded/user-facing data exposure; run `coverage-write` under the completion workflow audit worker routing whenever the verification lane includes owner coverage; finish with the parent's explicit local final review (no spawned final-review subagent). Exception: trivial copy-only `apps/web` edits that change static text only and do not alter layout, behavior, auth, pricing logic, schema, runtime code, or security claims may skip completion-review subagents and use local readback plus focused checks. | Use `pnpm test:diff <path ...>` when it truthfully covers the touched owner, otherwise run the owner's scoped coverage command from the verification doc and add focused proof. For trivial copy-only `apps/web` edits, focused component/page tests plus typecheck and stale-string readback are enough when full app verification is credibly red for unrelated reasons. | `scripts/finish-task` if plan-bearing, otherwise `scripts/committer` |
| Standard repo change | Ordinary repo code/test/config change | `agent-docs/operations/completion-workflow.md`, `agent-docs/operations/verification-and-runtime.md` | Yes | Yes for multi-file or high-risk work | Mandatory before handoff: for prompt-primary changes, run only `prompt-review` unless non-prompt code independently triggers another pass; otherwise run `security-privacy-review` when the change materially touches auth/session behavior, secrets, payments, external ingress/egress, public APIs/routes, trust boundaries, or persisted/uploaded/user-facing data exposure; run `coverage-write` under the completion workflow audit worker routing whenever the verification lane includes owner coverage; add `deep-review` when the completion workflow's complex-or-sensitive conditions apply; finish with the parent's explicit local final review, and treat the external `review:gpt pr-review` loop (fired on push, in parallel with PR CI) as the required final review gate for PR-lane work | Follow verification doc; prefer `pnpm test:diff <path ...>` when it is truthful, otherwise run the touched owner coverage command(s) and add direct scenario proof when required | `scripts/finish-task` if plan-bearing, otherwise `scripts/committer` |
| High-risk or cross-cutting change | Auth, secrets, trust boundaries, runtime entrypoints, schema/storage, billing, deploy surfaces, or broad refactors | `agent-docs/SECURITY.md`, `agent-docs/RELIABILITY.md`, `agent-docs/operations/completion-workflow.md`, `agent-docs/operations/verification-and-runtime.md` | Yes | Yes | Mandatory before handoff: run `security-privacy-review`; run `coverage-write` under the completion workflow audit worker routing whenever the verification lane includes owner coverage; add `deep-review` when the completion workflow's complex-or-sensitive conditions apply; finish with the parent's explicit local final review, and treat the external `review:gpt pr-review` loop (fired on push, in parallel with PR CI) as the required final review gate for PR-lane work | Full verification baseline unless the user explicitly says otherwise; when the change is scoped enough for owner-level verification, prefer truthful `test:diff` coverage or the edited owner coverage command(s) | `scripts/finish-task` |

## Speciality Reads

- Read `agent-docs/FRONTEND.md` for user-facing `apps/web` UI work such as pages, shared components, or design-system-facing surfaces.
- Read `agent-docs/PRODUCT_SENSE.md` and `agent-docs/PRODUCT_CONSTITUTION.md` for product behavior, UX tradeoffs, or user-facing spec decisions.
- Read `agent-docs/references/testing-ci-map.md` when selecting, adding, or debugging tests.
- Read `agent-docs/SECURITY.md` for auth, secrets, external interfaces, or trust-boundary changes.
- Read `agent-docs/RELIABILITY.md` for retries, queues, cron, concurrency, or failure-mode work.

## Workflow Defaults

- Same-turn task completion counts as acceptance unless the user explicitly says `review first` or `do not commit`.
- Preserve unrelated working-tree edits in the current checkout and never revert work you did not make.
- Default most non-trivial repo code/test/config changes to an isolated git worktree with a dedicated task branch, then open a PR after the normal scoped commit. Treat this as the expected lane for standard, high-risk, cross-cutting, or likely-overlapping work. Before creating the worktree, inspect current status and this ledger, choose a task-scoped branch/worktree name, and keep the normal plan, audit, verification, and commit workflow inside that worktree.
- Use the current checkout directly for review-only work, vault-only data work, prompt-primary changes, text-only docs/process edits, minor copy/static-content changes, and other tiny low-risk edits where a worktree/PR would add more process than isolation value. Do not create or switch branches in the current checkout as a dirty-worktree workaround; if isolation is needed, use a separate worktree/branch or stop/report when setup is unsafe.
- Prefer narrow ledger rows and narrow plans.
- Treat supplied patches as behavioral intent, not overwrite authority.
- If a change introduces or changes a durable repo rule, update the durable doc in the same turn.
- The 1,000-line touch-time split policy is paused. Do not treat oversized hand-authored files as an automatic split/refactor requirement unless the current user task asks for giant-file cleanup or the split is independently the simplest durable fix.
- Required completion-workflow audit subagent passes are mandatory for the repo task classes that require them. Treat this workflow doc plus `AGENTS.md` as standing user approval and explicit repo instruction to spawn those required local audit subagents when a repo task reaches that workflow, even if general agent guidance says not to spawn subagents without an explicit user request. Do not stop after implementation, verification, or commit, and do not pause only to ask for a second explicit "use subagents" instruction.
- For non-trivial PR-lane work, the external `review:gpt pr-review` loop in `agent-docs/operations/pr-deep-review-loop.md` is the required final review stage and merge-readiness gate after the completion workflow. Fire each round as soon as the head it reviews is pushed, in parallel with PR CI — do not wait for green CI to start a round. Do not report a PR as good to merge until that loop reaches zero accepted findings and PR CI is green on the final head, unless the current user task explicitly opts out. After a zero-finding round, a later base-branch-only PR update does not require rerunning `review:gpt`; wait for CI on the updated head and continue the merge path. Docs/process-only PRs and trivial copy-only changes stay exempt unless the user asks for the loop.
- Codex-native agents satisfy required completion audit passes with spawned local subagents, not `codex exec`. Non-Codex parent agents such as Claude route only the Codex-billed `security-privacy-review` and `coverage-write` passes through the local Codex CLI (`codex exec`, with `CODEX_HOME` taken from the local `MURPH_AUDIT_CODEX_HOME` override when set, otherwise the Codex CLI's normal home resolution). The remaining required audit subagents (`prompt-review`, `frontend-review`, `deep-review`) run on whatever model the parent agent is currently running on. All audit subagents use high reasoning by default. Use xhigh reasoning for large or complex changes, high-risk/cross-cutting changes, or audits spanning multiple owners, architecture decisions, or trust-boundary decisions. If subagent tooling or Codex CLI auth needed for a non-Codex parent is unavailable, report the limitation and run the pass on the parent agent's current model instead of skipping it.
- For prompt-primary changes, run the completion workflow's `prompt-review` pass as the only required completion audit unless non-prompt code independently triggers another audit pass. The prompt-review pass must read the current OpenAI prompt guidance every time.
- For user-facing `apps/web` UI changes, the completion workflow's `frontend-review` pass is a mandatory audit alongside any other required passes for the task class.
- For changes that materially touch auth/session behavior, secrets, payments, external ingress/egress, public APIs/routes, trust boundaries, or persisted/uploaded/user-facing data exposure, the completion workflow's `security-privacy-review` pass is a mandatory audit alongside any other required passes for the task class.
- For particularly complex or sensitive changes, the completion workflow's `deep-review` pass is a mandatory extra audit alongside the specialized and final passes when the complex-or-sensitive conditions apply.
- Exception: really low-impact copy-only `apps/web` edits may skip `security-privacy-review`, `frontend-review`, and `coverage-write` subagents when they only change static text and do not affect layout, UI state, auth, pricing logic, schemas, runtime behavior, or security claims. Still run local readback and the narrowest focused checks that prove the copy surface.
- Active-plan work is not complete when only the code/docs/test/config files are committed. The matching ledger row must be removed and the plan must leave `agent-docs/exec-plans/active/` before handoff.
- `scripts/finish-task` is the normal final commit path for active-plan work. It resolves the file/directory paths you pass into exact changed file paths, removes the one coordination-ledger row whose `Plan` cell exactly matches the active plan path, closes the active plan, moves it to `agent-docs/exec-plans/completed/`, and creates a scoped commit containing the closed-plan artifact plus those resolved paths. When that ledger row exists in `HEAD`, the commit also includes only this task's ledger-row removal; unrelated dirty ledger rows stay in the working tree. It fails closed if the worktree ledger match is missing or ambiguous.
- Do not use `scripts/committer` or raw `git commit` as the final task commit for work that has an active plan unless the user explicitly asks to leave the plan active.
- If a plan-bearing task cannot safely create a scoped commit because overlapping dirty files would force an unsafe partial stage, do not leave the plan under `active/`; clear the matching ledger row and archive it with `scripts/close-exec-plan.sh` before handoff.

## Quick Path

For tiny repo-internal workflow/tooling changes:

- Load `agent-docs/operations/verification-and-runtime.md` and `agent-docs/operations/completion-workflow.md`.
- Stay on the low-risk fast path only when the touched files and risk level meet those docs' explicit criteria.
- Prefer `pnpm typecheck` plus direct touched-file checks over the full repo-wide test/coverage lanes when that fast path applies.
- For package/app changes, prefer `pnpm test:diff <path ...>` when it truthfully covers the task; otherwise run the edited owner's scoped coverage command before the required `coverage-write` pass using the completion workflow audit worker routing and final review.
- Finish with the parent's explicit local final review; final review is never a spawned subagent pass.

## Persisted State Placement Gate

Before landing any new persisted state, classify it explicitly and place it in the matching root.

| State class | Canonical root | Required rule |
| --- | --- | --- |
| Canonical product truth | `vault/**` | Must be writable only through `packages/core`-owned canonical mutation paths. |
| Durable local operational state | `.runtime/operations/**` | Use for tokens, cursors, daemon/service metadata, local tool config, and other non-canonical state you expect to survive restarts. Also classify each path explicitly as `portable` or `machine_local`; hosted bundle inclusion is denylist-based for this bucket so unsafe/process-local state must be explicitly excluded. |
| Rebuildable local projection | `.runtime/projections/**` | Use for indexes, serving stores, and other derived read models that can be rebuilt from canonical evidence plus durable operational state. |
| Assistant/session runtime state | `.runtime/operations/assistant/**` | Use for durable but non-canonical assistant runtime/session residue such as outbox, diagnostics, receipts, transcripts, and related execution state. Hosted snapshots preserve durable `.runtime/operations/**` state by default except explicit unsafe/process-local exclusions. Durable user-facing memory and scheduled prompt configuration belong in canonical vault records instead. |
| Ephemeral scratch/cache | `.runtime/cache/**` or `.runtime/tmp/**` | Use only for deleteable caches, sockets, temp files, or scratch artifacts. |

Additional gate rules:

- If a datum is user-facing, queryable, or something future product features will build on, it must not start life in assistant runtime or other operational state. Use canonical `vault/**`, or explicit `derived/**` materializations when the value is derived rather than authoritative.
- Durable JSON state must include an explicit `schema` or `schemaVersion` seam.
- Durable SQLite state must include an explicit `PRAGMA user_version` migration seam.
- Do not hide durable local operational state under generic `.runtime/*` flat files when a typed bucket already exists.
- Do not put local-only secrets/tokens into hosted snapshots just because they are durable locally; make the hosted-vs-local snapshot policy explicit.

## Mechanical Vs Policy

- Mechanical/enforced rules live in scripts, tests, lint-like guards, or CI wherever possible.
- `AGENTS.md` and this doc should point to those guards or to the durable policy doc, not duplicate large policy blobs.
- The prior 1,000-line touch-time policy is paused. `agent-docs/references/giant-file-composability-seams.md` remains planning guidance for intentional giant-file cleanup, not an active workflow gate.
- Keep `AGENTS.md` intentionally small. Treat roughly 100 lines as the soft ceiling and preserve the same stable shape: purpose, precedence, always-read set, task router, non-negotiable invariants, workflow defaults, and notes.
- If a rule matters and keeps drifting, prefer encoding it into tooling over expanding `AGENTS.md`.
