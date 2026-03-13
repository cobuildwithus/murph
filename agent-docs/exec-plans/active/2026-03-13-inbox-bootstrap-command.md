# Inbox bootstrap command

Status: completed
Created: 2026-03-13
Updated: 2026-03-13

## Goal

- Replace the brittle `pnpm setup:inbox` flag-forwarding wrapper with a first-class `vault-cli inbox bootstrap` command that owns the split between init-only and setup-only options.

## Success criteria

- `vault-cli inbox bootstrap` runs inbox initialization and parser-toolchain setup in one CLI command.
- Bootstrap accepts init-only flags such as `--rebuild` without leaking them into setup-only parsing.
- Bootstrap accepts setup-only flags such as `--whisperCommand` without leaking them into init-only parsing.
- `pnpm setup:inbox` becomes a thin alias that installs/builds, then delegates only to `vault-cli inbox bootstrap`.
- Inbox docs, smoke coverage, and focused tests reflect the new command surface.

## Scope

- In scope:
- inbox CLI command registration, schemas, and service orchestration for bootstrap
- the local `setup:inbox` alias script
- README, command-surface docs, fixture coverage, and focused inbox tests
- Out of scope:
- changing standalone `inbox init` or `inbox setup` semantics beyond shared option reuse
- parser toolchain discovery or inbox runtime storage behavior

## Constraints

- Work on top of active adjacent inbox/docs edits without reverting them.
- Keep bootstrap output contract explicit rather than inferring success from shell sequencing.
- Preserve `pnpm setup:inbox` as the documented repo bootstrap entrypoint.

## Risks and mitigations

1. Risk: Overlapping inbox/docs rows are actively editing nearby sections.
   Mitigation: limit code/docs changes to bootstrap-specific symbols and preserve surrounding edits verbatim.
2. Risk: Command-surface coverage requires docs, smoke fixtures, and CLI tests to stay in sync.
   Mitigation: update the command docs and add the matching smoke scenario/golden-output entry in the same change.
3. Risk: Existing dirty-worktree failures may obscure bootstrap regressions.
   Mitigation: run the required checks plus focused inbox tests and separate any pre-existing failures from the bootstrap diff.

## Tasks

1. Add a combined inbox bootstrap service method, schema, and CLI command.
2. Slim the shell alias to one bootstrap delegation.
3. Update inbox docs and smoke coverage.
4. Run completion-workflow audits, required verification, remove the ledger row, and commit the touched files.

## Outcome

- Done: `vault-cli inbox bootstrap` now owns the combined local inbox init + parser setup flow with one CLI contract and correctly split option families.
- Done: `pnpm setup:inbox` is now a thin shell alias that installs/builds and delegates only to `vault-cli inbox bootstrap`.
- Done: README, command-surface docs, and smoke coverage now document the bootstrap command and track its baseline command string.
- Done: bootstrap-only completion-workflow audits found no actionable simplify, coverage, or final-review issues beyond the implemented focused tests.

## Verification

- `pnpm exec tsc -p packages/cli/tsconfig.typecheck.json --pretty false --noEmit` passed.
- `pnpm exec vitest run packages/cli/test/inbox-cli.test.ts packages/cli/test/inbox-incur-smoke.test.ts --no-coverage --maxWorkers 1 -t "bootstrap|first-pass operator commands|source add schema|root help"` passed.
- `pnpm exec tsx e2e/smoke/verify-fixtures.ts --coverage` passed.
- `pnpm typecheck` failed for pre-existing workspace issues outside this change: `packages/core` typecheck is blocked by `packages/contracts/dist/index.d.ts` build-state errors (`TS6305`) plus an existing `packages/core/src/mutations.ts` indexing error (`TS7053`).
- `pnpm test` failed for a pre-existing unrelated CLI package-shape guard: `packages/cli/scripts/verify-package-shape.ts` reports `test/canonical-write-lock.test.ts still reaches into another package's src tree`.
- `pnpm test:coverage` failed for the same pre-existing unrelated CLI package-shape guard before coverage reached the new bootstrap scenario.
