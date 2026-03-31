# Simplify audit policy update

Status: completed
Created: 2026-04-01
Updated: 2026-04-01

## Goal

- Update the durable repo workflow docs so the simplify audit is no longer the default completion step and is only called out as an exceptional pass for massive non-patch changes.

## Success criteria

- `agent-docs/operations/completion-workflow.md` documents `task-finish-review` as the default audit and narrows `simplify` to exceptional use.
- `agent-docs/operations/agent-workflow-routing.md` matches the completion workflow audit expectations.
- `agent-docs/index.md` reflects the updated workflow policy so the durable-doc index stays truthful.
- Required verification runs are recorded, and the task lands in a scoped commit without disturbing unrelated worktree changes.

## Scope

- In scope:
  - update the completion-workflow doc
  - update the workflow-routing summary table
  - update the durable-doc index language affected by this policy change
- Out of scope:
  - changing scripts or enforcing the rule mechanically
  - removing the simplify prompt asset
  - changing unrelated audit/review tooling or verification rules

## Constraints

- Technical constraints:
  - preserve unrelated dirty-tree edits
  - keep the rule phrased as temporary/exceptional guidance, not a broad removal of review
- Product/process constraints:
  - align all touched durable docs in the same turn
  - keep final review required for repo changes unless docs/process routing already skips audits

## Risks and mitigations

1. Risk: the docs could become internally inconsistent about when simplify still applies.
   Mitigation: update the routing doc, completion workflow, and index together with the same wording.

2. Risk: the change could read like all audits are disabled.
   Mitigation: keep `task-finish-review` as the explicit default audit step for repo code/test/config work.

## Tasks

1. Update the coordination ledger and active plan. Completed.
2. Patch the durable workflow docs with the narrowed simplify-audit policy. Completed.
3. Run required verification, close the plan, and create a scoped commit. In progress.

## Decisions

- Keep the simplify prompt in the repo for exceptional future use instead of deleting it.
- Describe simplify as exceptional for massive changes that were developed locally rather than landed from a bounded external patch.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test`
- Expected outcomes:
  - commands pass, or any failure is documented as credibly unrelated to this docs-only diff
- Results:
  - `pnpm typecheck` passed
  - `pnpm test` passed
Completed: 2026-04-01
