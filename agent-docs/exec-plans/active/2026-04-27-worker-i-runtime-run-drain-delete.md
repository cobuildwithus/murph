# Worker I Runtime Run-Drain Delete

## Goal

Remove assistant-runtime legacy hosted run-drain execution helpers and related
test/parser residue that is no longer part of the greenfield workspace-run path.

Success criteria:

- `packages/assistant-runtime` no longer exposes or carries
  `executeHostedRunDrainForCommit` / `completeHostedRunDrainAfterCommit`.
- Assistant-runtime package entrypoints stay focused on workspace-run, mailbox,
  and import/checkpoint seams.
- The hosted-execution turn-input refresh route constant is gone when live
  callers have moved.
- Shared run-control parser exports are removed only when `rg` proves no live
  production imports remain.

## Constraints

- Preserve unrelated dirty work in the shared checkout.
- Do not touch Cloudflare runner transport/container or web routes.
- Do not reintroduce web-owned run acquire/commit/finalize, turn-input
  peek/adopt, committed sequence, or event adoption.
- Do not delete shared parser exports that still have live production callers
  outside this worker's ownership.

## State

Implementation verified; handoff is blocked on required local Codex audit
subagents because the Codex CLI returned a usage-limit error before the
`security-privacy-review` pass could inspect the diff.

Initial inspection:

- `executeHostedRunDrainForCommit` and `completeHostedRunDrainAfterCommit` only
  have package-local production definitions plus assistant-runtime tests.
- `packages/hosted-execution/src/parsers/run-control.ts` is still imported
  through the public parser barrel by live Cloudflare code outside this worker's
  scope.
- `HOSTED_EXECUTION_RUNNER_TURN_INPUT_REFRESH_PATH` is still imported by
  Cloudflare runner-outbound code outside this worker's scope.

Later inspection after concurrent Worker H changes:

- `rg` showed no remaining live production imports for the run-control parser
  barrel exports or the turn-input refresh route constant, so Worker I removed
  the package-local parser/export/test residue within the owned packages.

## Verification Plan

- `rg` for removed helper names, turn-input refresh constant, and run-control
  parser imports.
- `pnpm --dir packages/assistant-runtime typecheck`
- `pnpm --dir packages/assistant-runtime test`
- `pnpm --dir packages/hosted-execution typecheck`
- `pnpm --dir packages/hosted-execution test`
- `git diff --check`

Verification result:

- `rg` only finds negative assertions for the removed package entrypoint/parser
  names and the removed turn-input refresh route constant.
- `pnpm --dir packages/assistant-runtime typecheck` passed.
- `pnpm --dir packages/assistant-runtime test` passed: 43 files, 324 tests.
- `pnpm --dir packages/hosted-execution typecheck` passed.
- `pnpm --dir packages/hosted-execution test` passed: 17 files, 90 tests.
- `git diff --check` passed.
- Required `security-privacy-review`, `coverage-write`, and
  `task-finish-review` subagents did not run; the first Codex CLI subagent
  invocation failed with a usage-limit error before review began.
