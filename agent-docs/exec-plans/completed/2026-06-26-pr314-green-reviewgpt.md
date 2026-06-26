# PR 314 Green + ReviewGPT

## Goal

Land PR 314 by updating it to current `main`, resolving CI failures, running the required ReviewGPT PR loop with ZIP context, and merging once checks are green.

## Scope

- Resolve conflicts in hosted computer handoff routing and its tests.
- Fix the current CLI release smoke failure around the ReviewGPT PR-review preset contract.
- Keep changes limited to the PR's handoff/contact-routing behavior plus the exact CI blocker.

## Constraints

- Preserve hosted computer handoff token/session authority and hidden delivery-context behavior.
- Preserve the return-contact-kind owner seam now present on `main`.
- Do not commit local ReviewGPT browser/profile configuration.
- Keep review artifacts under `audit-packages/` uncommitted.

## Verification

- Run the focused affected tests for hosted handoff behavior and the release preset smoke failure.
- Run `pnpm typecheck`.
- Run the PR ReviewGPT loop on the pushed PR head with ZIP context until zero accepted findings.
- Confirm GitHub PR checks are green on the final head before merge.

## Status

Completed 2026-06-26.

## Outcomes

- Merged current `main` into PR 314 and resolved handoff return-routing conflicts.
- Verified `pnpm typecheck` after workspace build artifacts were prepared.
- Verified `bash scripts/workspace-verify.sh test:diff` for the affected handoff, assistant-engine, CLI, web, and hosted runtime surfaces.
