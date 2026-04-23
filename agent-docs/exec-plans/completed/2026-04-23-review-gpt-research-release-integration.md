# Release and integrate the patched `review-gpt` for Health Commons research

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Move Murph's research workflow onto the released `@cobuild/review-gpt` patch that supports disabling repomix attachments, then use that new config for current and future research workspaces.

## Success criteria

- `../review-gpt` patch release is confirmed published on npm.
- Murph depends on the released `@cobuild/review-gpt` version in `package.json` and `pnpm-lock.yaml`.
- Research config generation sets `repomix_attachment_format="none"` without changing the normal repo-wide review flow.
- Active research workspaces use the same no-repomix setting immediately.
- Verification proves Murph still typechecks/tests and that generated research config output carries the new setting.

## Scope

- In scope:
  - `package.json`
  - `pnpm-lock.yaml`
  - `scripts/research-orchestrator/lib.mjs`
  - directly coupled repo-tool tests if needed
  - current research workspace configs under `output-packages/research/**/config/*.sh`
  - `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
  - this active plan
- Out of scope:
  - changing the normal non-research `review:gpt` packaging defaults
  - research prompt/content edits unrelated to the repomix disable path
  - landing Health Commons content files

## Constraints

- Preserve unrelated dirty-tree work, especially in the shared coordination ledger.
- Keep the no-repomix change scoped to research runs only.
- Prefer deterministic verification over live sends where possible.

## Tasks

1. [x] Confirm the `review-gpt` patch release is published.
2. [x] Register this lane in the coordination ledger.
3. [x] Update Murph to the released `@cobuild/review-gpt` version.
4. [x] Disable repomix for generated and current research workspace configs.
5. [x] Run scoped verification and commit the Murph diff.

## Verification

- `pnpm exec cobuild-review-gpt --config output-packages/research/whole-body-red-and-near-infrared-light-exposure-20260423-040204Z/config/review-gpt-work-profile.sh --prompt-file output-packages/research/whole-body-red-and-near-infrared-light-exposure-20260423-040204Z/prompts/12-source-extraction-batch-001.md --send --dry-run --format json`
- `node --check scripts/research-orchestrator/lib.mjs`
- `bash -n output-packages/research/cold-plunge-20260422-091157Z/config/review-gpt-research.config.sh output-packages/research/cold-plunge-20260422-091157Z/config/review-gpt-work-profile.sh output-packages/research/whole-body-red-and-near-infrared-light-exposure-20260423-040204Z/config/review-gpt-research.config.sh output-packages/research/whole-body-red-and-near-infrared-light-exposure-20260423-040204Z/config/review-gpt-work-profile.sh`
- `pnpm test:repo-tools -- --runInBand scripts/research-init.test.ts`
- `pnpm typecheck`
- `pnpm deps:ignored-builds`
Completed: 2026-04-23
