# Replace AGENTS simplicity wording

Status: completed
Created: 2026-06-03
Updated: 2026-06-03

## Goal

- Replace the existing top-of-file `AGENTS.md` deletion/simplicity section with
  the user's revised radical-simplicity wording.

## Success criteria

- `AGENTS.md` starts with the revised deletion/radical-simplicity guidance.
- The section remains text-only and scoped to the existing top section.
- Required verification passes for the touched Markdown/docs workflow.

## Scope

- In scope:
  - `AGENTS.md`
  - This execution plan and its coordination-ledger row
- Out of scope:
  - Runtime code, package/app behavior, tests, and unrelated active work

## Constraints

- Technical constraints:
  - Preserve unrelated dirty work in the current checkout.
  - Keep the change Markdown-only.
- Product/process constraints:
  - Avoid local path or direct personal identifier leakage in committed
    artifacts.

## Risks and mitigations

1. Risk: The replacement broadens durable workflow policy beyond the user's
   requested wording.
   Mitigation: Replace only the existing top simplicity paragraph.

## Tasks

1. Read the required docs/process workflow context.
2. Replace the top `AGENTS.md` simplicity section.
3. Read back the touched section and run required verification.
4. Close the plan and create a scoped commit.

## Decisions

- Keep the existing section heading and replace only the body text.

## Verification

- Commands to run:
  - `sed -n '1,50p' AGENTS.md`
  - `pnpm test:diff AGENTS.md`
  - `pnpm typecheck`
- Expected outcomes:
  - Readback shows the revised section text.
  - Verification passes, or any failure is proven unrelated to this
    Markdown-only change.
- Results:
  - Passed: `sed -n '1,55p' AGENTS.md`
  - Passed: `pnpm test:diff AGENTS.md`
  - Passed: `pnpm typecheck`
Completed: 2026-06-03
