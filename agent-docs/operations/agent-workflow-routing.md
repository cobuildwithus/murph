# Agent Workflow Routing

Last verified: 2026-04-01

This doc is the durable workflow map behind `AGENTS.md`.
Use it to classify the task, load only the relevant docs, and choose the right verification, audit, and commit path.

## Always-Read Set

Before repo code/docs/test/config work, read:

1. `agent-docs/index.md`
2. `ARCHITECTURE.md`
3. `agent-docs/references/repo-scope.md`
4. this file

Then load only the task-relevant docs listed below.

## Task Classes

| Task class | Typical scope | Also read | Ledger | Plan | Audits | Verification | Commit path |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Vault-only data | Writes stay under `vault/**` | `agent-docs/operations/verification-and-runtime.md` | No | No by default | No by default | Read back touched records and any mutation artifacts | No repo commit unless asked |
| Docs/process-only | Repo docs, process docs, plans, agent workflow docs | `agent-docs/operations/verification-and-runtime.md` | Yes | For multi-file, durable-rule, or likely multi-turn work | No by default | Text-only `.md` docs edits/deletions may use the docs-only fast path; other docs/process work still follows the repo baseline or scoped-verification rules in the verification doc | `scripts/finish-task` if plan-bearing, otherwise `scripts/committer` |
| Tiny low-risk repo change | Narrow, single-purpose repo code/test/config change in one subsystem | `agent-docs/operations/completion-workflow.md`, `agent-docs/operations/verification-and-runtime.md` | Yes | Usually optional unless multi-file/high-risk | `task-finish-review` only | Follow verification doc; add focused proof | `scripts/finish-task` if plan-bearing, otherwise `scripts/committer` |
| Standard repo change | Ordinary repo code/test/config change | `agent-docs/operations/completion-workflow.md`, `agent-docs/operations/verification-and-runtime.md` | Yes | Yes for multi-file or high-risk work | `task-finish-review` by default; add `simplify` only for massive non-patch changes | Follow verification doc; add direct scenario proof when required | `scripts/finish-task` if plan-bearing, otherwise `scripts/committer` |
| High-risk or cross-cutting change | Auth, secrets, trust boundaries, runtime entrypoints, schema/storage, billing, deploy surfaces, or broad refactors | `agent-docs/SECURITY.md`, `agent-docs/RELIABILITY.md`, `agent-docs/operations/completion-workflow.md`, `agent-docs/operations/verification-and-runtime.md` | Yes | Yes | `task-finish-review` required; add `simplify` only for massive non-patch changes | Full verification baseline unless the user explicitly says otherwise | `scripts/finish-task` |

## Speciality Reads

- Read `agent-docs/FRONTEND.md` and `packages/local-web/AGENTS.md` for UI or `packages/local-web` work.
- Read `agent-docs/PRODUCT_SENSE.md` and `agent-docs/PRODUCT_CONSTITUTION.md` for product behavior, UX tradeoffs, or user-facing spec decisions.
- Read `agent-docs/references/testing-ci-map.md` when selecting, adding, or debugging tests.
- Read `agent-docs/SECURITY.md` for auth, secrets, external interfaces, or trust-boundary changes.
- Read `agent-docs/RELIABILITY.md` for retries, queues, cron, concurrency, or failure-mode work.

## Workflow Defaults

- Same-turn task completion counts as acceptance unless the user explicitly says `review first` or `do not commit`.
- Preserve unrelated worktree edits and never revert work you did not make.
- Prefer narrow ledger rows and narrow plans.
- Treat supplied patches as behavioral intent, not overwrite authority.
- If a change introduces or changes a durable repo rule, update the durable doc in the same turn.
- `scripts/finish-task` resolves the file/directory paths you pass into exact changed file paths, closes the active plan, moves it to `agent-docs/exec-plans/completed/`, and creates a scoped commit containing the closed-plan artifact plus those resolved paths.

## Mechanical Vs Policy

- Mechanical/enforced rules live in scripts, tests, lint-like guards, or CI wherever possible.
- `AGENTS.md` and this doc should point to those guards or to the durable policy doc, not duplicate large policy blobs.
- Keep `AGENTS.md` intentionally small. Treat roughly 100 lines as the soft ceiling and preserve the same stable shape: purpose, precedence, always-read set, task router, non-negotiable invariants, workflow defaults, and notes.
- If a rule matters and keeps drifting, prefer encoding it into tooling over expanding `AGENTS.md`.
