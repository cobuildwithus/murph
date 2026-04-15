# Split hosted-execution parser clusters into focused modules

Status: completed
Created: 2026-04-09
Updated: 2026-04-09

## Goal

- Land the downloaded Pro patch intent for `packages/hosted-execution/src/parsers.ts`.
- Reduce mixed responsibilities in the parser file without changing current package ownership boundaries.

## Success criteria

- Shared parser assertions move into a focused helper module.
- Telegram parsing moves into its own module.
- Assistant-cron and device-sync reason parsing move out of `parsers.ts`.
- Existing delegation of device-sync wake-hint parsing to `@murphai/device-syncd/hosted-runtime` remains intact.
- Focused tests cover the extracted seams and the repo passes truthful verification for the touched package or reports only unrelated blockers.

## Scope

- In scope:
  - `packages/hosted-execution/src/parsers.ts`
  - `packages/hosted-execution/src/parsers/assertions.ts`
  - `packages/hosted-execution/src/parsers/device-sync.ts`
  - `packages/hosted-execution/src/parsers/telegram.ts`
  - `packages/hosted-execution/test/parsers.test.ts`
- Out of scope:
  - broader hosted-execution parser redesign
  - moving wake-hint ownership back out of `@murphai/device-syncd`
  - unrelated cleanup elsewhere in `packages/hosted-execution`

## Current state

- The downloaded patch targets the right file cluster, but it predates the current branch's delegation of wake-hint parsing to the `device-syncd` owner package.
- `packages/hosted-execution/src/parsers.ts` is still a large mixed-responsibility file with shared assertions, Telegram parsing, event parsing, and reason helpers all colocated.
- The package already has broad parser coverage, but it does not yet have the focused extracted-seam test file returned by the artifact.

## Plan

1. Extract the artifact-compatible assertion and Telegram parser helpers into `src/parsers/**`.
2. Move cron/device-sync reason parsing into a focused module while preserving wake-hint delegation to the owner package.
3. Add the focused parser tests from the artifact where they still apply.
4. Run truthful verification for the touched package, then finish the required review and commit workflow.

## Risks and mitigations

1. Risk: reintroducing a package-boundary regression by duplicating the device-sync wake-hint parser locally.
   Mitigation: keep wake-hint parsing delegated to `@murphai/device-syncd/hosted-runtime` and treat the Pro patch as intent rather than literal overwrite authority.
2. Risk: breaking parser behavior through import churn.
   Mitigation: preserve the public parser surface and add focused tests for the extracted seams.
3. Risk: overlapping unrelated worktree edits.
   Mitigation: stay inside the scoped hosted-execution files and leave all other dirty paths untouched.

## Verification

- Expected truthful lane:
  - `pnpm typecheck`
  - `pnpm test:diff packages/hosted-execution/src/parsers.ts packages/hosted-execution/src/parsers/assertions.ts packages/hosted-execution/src/parsers/device-sync.ts packages/hosted-execution/src/parsers/telegram.ts packages/hosted-execution/test/parsers.test.ts`
  - `pnpm test:smoke`
Completed: 2026-04-09
