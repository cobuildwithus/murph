# ReviewGPT Legacy Data Proof Rule

Status: completed
Created: 2026-07-08
Updated: 2026-07-07

## Goal

- Add a durable audit-triage rule so deploy-skew and legacy-compatibility findings require evidence of an already-deployed surface or existing impacted data before they drive compatibility machinery.

## Success criteria

- ReviewGPT and completion audit triage docs tell agents to prove current deployment/data exposure before accepting legacy/deploy-skew fixes.
- The rule preserves the simplicity bar: reject or document speculative compatibility findings instead of adding architecture for data that does not exist.
- The round-7 local repair code remains dropped.

## Scope

- In scope:
  - Audit triage/process docs.
- Out of scope:
  - Runtime mailbox code, database migrations, and PR #454 behavior changes.

## Tasks

1. Confirm and drop the uncommitted round-7 repair code.
2. Add the process rule to the audit triage docs.
3. Run docs-focused verification and commit the process change.

## Decisions

- Current DB proof showed zero `group-newsletter.email-needed` mailbox items, so the round-7 compatibility repair is not worth landing for PR #454.
- Future legacy/deploy-skew fixes must prove an existing deployed producer/consumer, persisted rows, external clients, or rollback window that can actually hit the incompatibility.

## Verification

- Commands run:
  - `git diff --check`
  - `pnpm test:diff agent-docs/operations/pr-reviewgpt-loop.md agent-docs/operations/completion-workflow.md agent-docs/exec-plans/active/2026-07-08-reviewgpt-legacy-data-proof.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
  - `pnpm typecheck`
  - targeted readback of edited docs
Completed: 2026-07-07
