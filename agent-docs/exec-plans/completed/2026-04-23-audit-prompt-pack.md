# Add one-pass seam audit prompts for 36 core Murph seams

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Add a reusable prompt pack under `agent-docs/prompts/` with one bespoke one-pass audit prompt per seam for 36 core Murph seams.
- Keep each prompt short and focused while still anchoring the reviewer on the seam's real owner files, key invariants, and the combined risk-plus-simplification review shape the user wants.

## Success criteria

- 36 seam-specific Markdown prompt files exist under one prompt-pack folder plus an index README.
- Each prompt clearly names the seam, scopes the relevant owner paths, and asks for evidence-backed findings covering concrete bugs/security/trust-boundary risks plus behavior-preserving simplification targets.
- Prompt text stays concise and operator-ready rather than turning into a long policy document.
- The prompt pack reads cleanly end-to-end and the touched Markdown files pass direct readback and repo docs verification requirements for this task class.

## Scope

- In scope:
- `agent-docs/prompts/**` prompt-pack content for the 36 seam audits
- the active execution plan and coordination ledger updates required for this task
- Out of scope:
- changing runtime code, package boundaries, or existing audit workflow scripts
- running the actual seam audits
- adding a second prompt taxonomy outside the existing `agent-docs/prompts/` surface unless a local structure blocker appears

## Constraints

- Technical constraints:
- Keep prompts compact; the user wants focused prompts rather than long templates.
- Anchor seams to current repo ownership boundaries from architecture and package docs instead of inventing a parallel map.
- Product/process constraints:
- Use subagents to help draft/refine prompt clusters.
- Preserve unrelated dirty-tree work and avoid overlapping active lanes beyond the shared plan/ledger artifacts.
- Follow the docs/process verification path for Markdown-only edits if the diff stays text-only.

## Risks and mitigations

1. Risk: prompt seams drift from the repo's actual owner boundaries and create noisy audits.
   Mitigation: re-read architecture, package README ownership docs, and seam notes before finalizing the 36-file list.

2. Risk: prompts become too verbose to use repeatedly.
   Mitigation: keep each file to a short prompt body plus a minimal scope/focus section.

3. Risk: overlapping active work in the ledger/plan files causes avoidable churn.
   Mitigation: limit edits in shared coordination files to the single new row and the task's own plan artifact.

## Tasks

1. Confirm verification/workflow constraints and register the task in the active plan and coordination ledger.
2. Reconfirm the 36 seam list from architecture, package ownership docs, and source topology.
3. Draft prompt clusters in parallel with subagents, grouped by adjacent owner seams.
4. Assemble the final prompt pack under `agent-docs/prompts/`, add an index README, and normalize wording/formatting.
5. Run the docs verification path for the touched Markdown files and prepare the scoped handoff/commit flow.

## Decisions

- Store the new files under `agent-docs/prompts/` so they stay within the existing reusable prompt surface.
- Use one combined one-pass audit prompt per seam rather than separate risk and simplify passes.

## Verification

- Commands to run:
  - direct readback of the touched Markdown prompt files and README
  - repo docs/process verification commands appropriate for a text-only Markdown diff
- Expected outcomes:
  - prompt pack files are present, internally consistent, and scoped to the intended seam owners
  - required docs/process verification passes without widening into unrelated package/app test lanes
Completed: 2026-04-23
