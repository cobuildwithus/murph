# Green Repochecks

## Goal

Get the current checkout's repo acceptance checks green.

Success means the repo-level acceptance command passes on this checkout, with any fixes kept proportional to observed failures.

## Constraints

- Preserve unrelated working-tree edits if any appear during the task.
- Do not weaken production invariants or verification gates to make checks pass.
- Do not expose local personal identifiers, secrets, vault contents, prompts, or raw sensitive payloads in files or handoff.

## Plan

1. Run the repo acceptance command and capture the concrete failing targets.
2. Trace each failure to the smallest root cause.
3. Apply focused fixes and matching tests when needed.
4. Re-run focused checks during iteration, then the repo acceptance command.
5. Close the plan and commit the scoped changes when green.

## State

Initial repo acceptance failed at CLI package shape verification because `packages/cli/config.schema.json` was stale relative to the built CLI entrypoint.
Ran `pnpm --dir packages/cli gen:config-schema`; the generated diff removes stale `assistant onboarding` schema entries.
The next repo acceptance run passed the previous CLI package-shape point and failed in assistant-engine package coverage on a stale persisted-contract expectation.
The current checkout now contains assistant-engine bootstrap updates that rewrite persisted contracts when rendered output changes; full assistant-engine package coverage passes.
Repo acceptance now passes on the current checkout.
Safe scoped commit is blocked by overlapping active dirty work from other lanes in hosted-home UI and assistant-engine fallback files.

## Verification

- Failed: `pnpm verify:repo` at CLI package shape verification.
- Passed: `pnpm --dir packages/cli gen:config-schema`
- Passed: `pnpm --dir packages/cli verify:package-shape`
- Failed: `pnpm verify:repo` at assistant-engine package coverage.
- Passed: `pnpm --dir packages/assistant-engine test:coverage`
- Passed: `pnpm verify:repo`
- Passed: `git diff --check`
Status: completed
Updated: 2026-05-04
Completed: 2026-05-04
