# review:gpt data bundle flow

Status: completed
Created: 2026-03-18
Updated: 2026-03-18

## Goal

- Add a repo-local `review:gpt:data` flow that zips the selected Healthy Bob vault plus the matching vault-scoped `assistant-state` slice, then stages and optionally auto-sends that ZIP through the existing `review:gpt` ChatGPT draft workflow with no prompt text required.

## Success criteria

- Root `package.json` exposes a `review:gpt:data` script.
- The new flow reuses `@cobuild/review-gpt` rather than forking browser/upload logic.
- The packaged ZIP includes the selected vault contents plus matching `assistant-state` files, but excludes `.runtime`, `.env*`, and derived export-pack directories by default.
- The default path works with `--vault`, `HEALTHYBOB_VAULT`, or the saved default Healthy Bob vault when present.
- Docs and focused tests describe and verify the new behavior without regressing the existing source-audit `review:gpt` path.

## Scope

- In scope:
  - repo-local shell packaging for the data bundle ZIP
  - a dedicated `review-gpt` config and wrapper for upload-only data review
  - root docs/script updates and focused root-script coverage
- Out of scope:
  - changing the existing source-audit ZIP format
  - adding a new publishable npm package
  - packaging `.runtime` state, device OAuth material, or unrelated machine-local config

## Risks and mitigations

1. Risk: a naive “all data” ZIP could include secrets or machine-local runtime state.
   Mitigation: exclude `.runtime`, `.env*`, archives, and derived export-pack directories by default, and only include the selected vault plus matching assistant-state bucket.
2. Risk: the new flow could break the existing `review:gpt` source-audit entrypoint.
   Mitigation: keep the data flow additive via its own config/wrapper and leave `scripts/review-gpt.config.sh` unchanged.
3. Risk: default-vault resolution could drift from CLI behavior.
   Mitigation: mirror the documented precedence order: explicit `--vault`, then `HEALTHYBOB_VAULT`, then the saved default operator config.

## Tasks

1. Add an active packaging script that builds a redacted-layout data ZIP for the selected vault context.
2. Add a dedicated `review:gpt:data` wrapper/config that reuses `@cobuild/review-gpt` upload-only staging and defaults to auto-send unless explicitly disabled.
3. Update root docs/tests to describe the new flow and verify the root script wiring.
4. Run required checks and the completion workflow audit sequence, then close the plan.

## Verification

- Focused: root script/package coverage around `review:gpt:data` and the data bundle script/config.
- Required repo checks: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`.
Completed: 2026-03-18
