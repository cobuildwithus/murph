# top-level run alias

Status: completed
Created: 2026-03-23
Updated: 2026-03-23

## Goal

- Add a top-level `run` alias so installed shims can invoke the assistant automation loop with `healthybob run` and `vault-cli run`, matching the existing root `chat` ergonomics without changing `assistant run` behavior.

## Success criteria

- `healthybob run --help` and `vault-cli run --help` resolve to the same command contract as `assistant run`.
- Default-vault injection applies to the new root `run` alias the same way it already applies to `chat`.
- Root command docs, generated command metadata, and the descriptor manifest all reflect the new alias.
- Required repo checks pass after the alias is added.

## Scope

- In scope:
  - root CLI alias wiring for `run`
  - default-vault injection support for `run`
  - generated command metadata, manifest truthfulness, and focused tests
  - README and command-surface doc updates for the new alias
- Out of scope:
  - changing `assistant run` runtime semantics
  - changing setup/onboard smart handoff behavior
  - changing the existing `assistant` namespace behavior

## Constraints

- Technical constraints:
  - keep the root alias byte-for-byte aligned with `assistant run` options and output shape
  - preserve explicit automation semantics; the alias should not add new implicit behavior
- Product/process constraints:
  - update active plan and coordination ledger before editing code
  - run required repo verification before handoff

## Risks and mitigations

1. Risk: the new alias could drift from `assistant run` and expose mismatched schema/help output.
   Mitigation: factor the command definition through a shared helper and add schema parity coverage.
2. Risk: docs or descriptor metadata could fall out of sync with the live root command topology.
   Mitigation: update the manifest/docs in the same change and keep the existing topology smoke test green.

## Tasks

1. Register the lane in `COORDINATION_LEDGER.md` and inspect the existing root `chat` alias pattern.
2. Add the shared root `run` alias wiring plus default-vault injection support.
3. Update generated command metadata, descriptor-manifest truth, focused tests, and operator docs.
4. Run required repo verification and commit the scoped files.

## Decisions

- Root `run` should be a direct shorthand for `assistant run`, not a new behavior layer.
- Bare `assistant` remains a namespace/help surface; the explicit top-level action is `run`.

## Verification

- Commands to run:
  - `pnpm exec vitest run --coverage.enabled=false packages/cli/test/assistant-cli.test.ts packages/cli/test/incur-smoke.test.ts`
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Expected outcomes:
  - focused CLI/schema tests pass
  - required repo checks pass with the new root alias included in docs and manifest coverage
- Outcome:
  - `pnpm exec vitest run --coverage.enabled=false packages/cli/test/assistant-cli.test.ts packages/cli/test/incur-smoke.test.ts` passed.
  - `pnpm typecheck` passed.
  - `pnpm test` passed.
  - `pnpm test:coverage` passed.
Completed: 2026-03-23
