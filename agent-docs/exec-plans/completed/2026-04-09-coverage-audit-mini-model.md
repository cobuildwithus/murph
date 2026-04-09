# Require gpt-5.4-mini for coverage audit passes

Status: completed
Created: 2026-04-09
Updated: 2026-04-09

## Goal

- Make the repo's completion workflow say unambiguously that the required `coverage-write` audit pass uses `gpt-5.4-mini`, not regular `gpt-5.4`.

## Success criteria

- `agent-docs/operations/completion-workflow.md` treats `gpt-5.4-mini` as the required model for `coverage-write`.
- `agent-docs/operations/agent-workflow-routing.md` points repo-change lanes at the mini-model `coverage-write` pass rather than a generic coverage audit.
- `agent-docs/prompts/coverage-write.md` says the pass must run on `gpt-5.4-mini` and should not silently widen to `gpt-5.4`.

## Scope

- In scope:
- Durable workflow docs for the coverage audit pass.
- The `coverage-write` prompt text that the spawned audit worker reads.
- Out of scope:
- Changing final-review audit model guidance.
- Changing non-coverage worker defaults elsewhere in the repo.

## Constraints

- Technical constraints:
- Keep the change doc-only and consistent with the existing completion workflow.
- Product/process constraints:
- Preserve the current audit sequence; only tighten the model requirement for the coverage pass.

## Risks and mitigations

1. Risk: only one doc mentions the model requirement and other workflow docs remain ambiguous.
   Mitigation: update both the workflow router and the detailed completion workflow, plus the prompt the worker actually receives.

## Tasks

1. Register the lane in `COORDINATION_LEDGER.md`.
2. Update the workflow docs to require `gpt-5.4-mini` for `coverage-write`.
3. Update the `coverage-write` prompt so the worker prompt matches the durable workflow rule.
4. Run the docs/tooling verification path, then close the plan and commit the scoped files.

## Decisions

- Treat `gpt-5.4-mini` as a required model choice for `coverage-write`, not a preference.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - direct readback of the touched docs/prompt
- Expected outcomes:
  - touched docs consistently require `gpt-5.4-mini` for `coverage-write`
  - if `pnpm typecheck` is red, the failure is documented as unrelated to this docs-only lane

## Results

- Updated the workflow router, detailed completion workflow, and `coverage-write` prompt so the coverage pass explicitly uses `gpt-5.4-mini` and not regular `gpt-5.4`.
- Direct readback confirmed the touched docs and prompt are aligned.
- `pnpm typecheck` failed for an unrelated pre-existing workspace issue in `packages/inbox-services/src/inbox-services/shared.ts`, which still cannot resolve `@murphai/contracts`.
Completed: 2026-04-09
