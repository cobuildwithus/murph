# Vault CLI nutrition and regimen recovery errors

Status: completed
Created: 2026-08-24
Updated: 2026-08-24

## Goal

- Make nutrition, regimen, meal-edit, and label-search failures actionable to a
  model through the bounded Vault CLI repair envelope without echoing submitted
  values, provider bodies, raw causes, credentials, or local paths.

## Success criteria

- Food save/import/edit and recipe import/edit validation failures identify the
  invalid field paths with value-free guidance.
- Protocol import maps core protocol issues to a stable CLI contract error with
  bounded field details.
- Meal edit rejects invalid IANA time zones at the command boundary with an
  actionable field error.
- Food and supplement label calls distinguish auth, throttling, server,
  timeout/transport, and malformed-success failures with truthful retryability.
- Focused unit, final machine-envelope, non-echo, and package type checks pass.

## Scope

- In scope: nutrition payload producers, protocol import error mapping,
  meal-edit timezone validation, the food/supplement label client, and focused
  recovery tests.
- Out of scope: shared JSON-input transport changes, command-manifest omissions,
  unrelated CLI error producers, deploy/runtime configuration, and provider
  logging infrastructure.

## Constraints

- Technical constraints: reuse `VaultCliError` repair fields; serialize only
  explicit bounded metadata; retain one transport owner and existing timeouts.
- Product/process constraints: preserve unrelated work, use the sanctioned task
  worktree, commit through `scripts/finish-task`, and do not push, open a PR, or
  run ReviewGPT in this delegated lane.

## Risks and mitigations

1. Risk: validation issues can contain submitted values or filesystem paths.
   Mitigation: map only issue path/code and fixed value-free messages/expected
   categories into the repair allowlist.
2. Risk: provider response bodies or raw transport causes can leak into model
   output.
   Mitigation: classify from status, abort state, and safe error names only;
   assert sentinel bodies, causes, and credentials are absent.
3. Risk: retryability can encourage futile retries or suppress recoverable ones.
   Mitigation: mark timeouts, transport failures, 429, and 5xx retryable; keep
   auth, deterministic 4xx, and malformed successful responses terminal.

## Tasks

1. [x] Trace current validation and provider failure owners plus focused tests.
2. [x] Add bounded repair mapping for food, recipe, protocol, and meal timezone.
3. [x] Replace label-response prose/body handling with typed safe classifications.
4. [x] Add producer and final-envelope recovery/non-echo tests.
5. [x] Run focused tests and typechecks, review the diff, update this evidence,
   and finish the scoped task commit.

## Decisions

- Classify this as a Product UX Patch: it restores the existing promise that a
  model can recover from a failed Vault CLI call in the same turn.
- Keep malformed successful label responses non-retryable because the response
  violates the provider contract and an identical replay has no evidence of
  succeeding; report a stable response-contract code instead.
- Rebased cleanly onto the advanced foundation candidate
  `f7cd7a10e91f2c72ae0c71300b983fbcb93d442d`; its CLI startup changes did not
  overlap this producer/client scope.

## Product UX Patch

- Outcome: the model can correct nutrition/regimen inputs or make a truthful
  retry decision without guessing from generic errors.
- Reaches: local and hosted assistant calls to food, recipe, protocol, meal edit,
  and food/supplement label commands.
- Proof: focused producer tests plus built/final JSON envelope assertions for
  stable code, retryability, stage, hint/field path, and explicit non-echoes.

## Journeys

1. A model submits an invalid nested food, recipe, or protocol field and receives
   the exact safe field path needed to repair the next call.
2. A model supplies a non-IANA timezone to meal edit and receives command-stage
   validation before any mutation runs.
3. A hosted model encounters label-provider auth, throttling, outage, timeout,
   or malformed success and receives a safe category with correct retryability.

## Verification

- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage
  packages/cli/test/food-labels.test.ts packages/cli/test/supplement-labels.test.ts
  packages/cli/test/food-save-typed-parity.test.ts
  packages/cli/test/recipe-save-typed-parity.test.ts
  packages/cli/test/protocol-save-typed-parity.test.ts`: 60 tests passed.
- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage
  packages/cli/test/cli-expansion-document-meal.test.ts`: 9 tests passed.
- `pnpm typecheck` in `packages/vault-usecases` and `packages/cli`: passed.
- `pnpm build:test-runtime:prepared`: passed on the rebased source.
- `MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1 pnpm exec vitest run --config
  packages/cli/vitest.workspace.ts --no-coverage
  packages/cli/test/incur-smoke.test.ts -t "built CLI preserves nutrition repair
  fields"`: 1 passed, 65 skipped.
- `git diff --check` plus scoped secret, identifier, unsafe-cast, stale-helper,
  provider-body, raw-cause, submitted-value, and absolute-path review: passed.
Completed: 2026-08-24
