# Schema token equals-form remediation

Status: completed
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Make compact schema-index token pagination honor supported equals-form flags so agents can reliably bound discovery output regardless of ordinary CLI spelling.

## Success criteria

- `--token-limit=<value>` and `--token-offset=<value>` use the same validation and last-explicit-value behavior as separated forms before `--`.
- Token-control-looking literals after `--` do not affect schema-index pagination.
- The existing single-pass token-control owner remains the only parser for fallback pagination.
- Focused schema-index tests, the real CLI Incur smoke, and CLI typecheck pass.

## Scope

- In scope: `extractTokenControls` equals-form handling and focused regression coverage.
- Out of scope: schema-index shape, leaf schemas, new output modes, unrelated CLI parsing, and preliminary specialist reruns.

## Constraints

- Technical constraints: extend the existing loop without a second parser, state abstraction, dependency, or schema-output owner; preserve separated-form behavior.
- Product/process constraints: remediate only the accepted PR #2599 specialist finding, keep the PR draft until parent review gates are satisfied, and keep identifiers/private evidence out of durable artifacts.

## Risks and mitigations

1. Risk: equals-form parsing could change invalid-value or repeated-option precedence.
   Mitigation: normalize both spellings through Incur's same validation and test mixed repeated values plus identical invalid-value results.
2. Risk: arguments intended as positional literals could unexpectedly paginate discovery output.
   Mitigation: preserve the loop's immediate stop at `--` and add a direct delimiter regression.

## Tasks

1. Reproduce the accepted equals-form gap on the exact pushed candidate.
2. Extend the existing single-pass token-control extraction for equals forms.
3. Add focused equals, repetition, validation, and delimiter regressions.
4. Run focused schema-index and real CLI smoke tests plus CLI typecheck.
5. Inspect the diff for scope/privacy, archive this plan with `scripts/finish-task`, push, and refresh PR evidence.

## Decisions

- Equals-form values are normalized before delegation, so Incur applies exactly the same validation as separated forms; valid repeated options still use the final explicit value.
- `--token-count` precedence remains unchanged; this remediation only fills the supported value-option spelling gap.
- The single extraction pass also supplies the delegate argv and omits the positional terminator suffix, keeping literal token-control-shaped arguments outside both parsing and Incur validation.

## Verification

- Commands to run:
  - `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/vault-cli-schema-index.test.ts`
  - `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/incur-smoke.test.ts -t 'root and group schema json requests return command indexes'`
  - `pnpm --filter @murphai/murph typecheck`
- Expected outcomes: equals-form token controls bound compact synthetic and real-root output exactly like separated forms, literals after `--` are ignored, and all checks pass.

## Results

- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/vault-cli-schema-index.test.ts`: 8 tests passed.
- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/incur-smoke.test.ts -t 'root and group schema json requests return command indexes'`: 1 test passed, 69 skipped; the real root equals-form request returned a 24-token truncated page.
- `pnpm --filter @murphai/murph typecheck`: passed.
- `git diff --check`: passed.
- Direct proof: equals limit, equals offset plus limit, mixed repeated spellings, invalid-value parity, and literal options after `--` all exercise the compact schema-index owner without a second parser or output mode.

## Progress

- [x] Reproduced the accepted equals-form failure on the exact pushed PR head.
- [x] Normalized equals-form controls in the existing single extraction pass.
- [x] Added synthetic and real-tree regression coverage.
- [x] Ran focused tests, typecheck, and diff hygiene checks.
- [x] Inspected the scoped diff for privacy, architecture, and unrelated changes.
Completed: 2026-08-30
