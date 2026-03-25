# Assistant auto-reply scan control flow

Status: completed
Created: 2026-03-26
Updated: 2026-03-26

## Goal

- Refactor `scanAssistantAutoReplyOnce(...)` so grouped-capture decisions and cursor advancement policy are explicit, while preserving current reply, skip, defer, failure, and artifact semantics exactly.

## Success criteria

- The scanner loop reads like an explicit state machine instead of a stack of partially duplicated branches.
- Skip/defer/fail outcomes are represented through named helpers or decision objects with explicit cursor advancement behavior.
- Existing semantics remain unchanged:
  - disabled/self-authored/existing-artifact/adapter-skip/prompt-skip/recent-self-echo branches skip and advance
  - prompt defer and reconnectable provider-loss branches skip and do not advance
  - generic send failures record failure artifacts, advance, and continue
- Artifact-writing behavior for success and failure remains unchanged.
- Focused scanner tests stay green, and one narrow cursor-policy test may be added if it improves protection without broadening behavior.

## Scope

- In scope:
  - `packages/cli/src/assistant/automation/scanner.ts`
  - targeted `packages/cli/test/assistant-runtime.test.ts`
  - this plan and the coordination ledger
- Out of scope:
  - widening auto-reply eligibility rules
  - changing capture grouping rules
  - changing prompt contents or adapter/provider contracts
  - broader assistant automation architecture work outside the scanner control-flow slice

## Constraints

- Preserve current cursor semantics exactly.
- Preserve current provider-connection-lost defer/retry behavior.
- Preserve current success/failure artifact writes and summary accounting.
- Work carefully on top of overlapping active assistant automation edits already present in the tree.

## Risks and mitigations

1. Risk: a refactor could accidentally advance the cursor in a defer/retry path and starve replay.
   Mitigation: encode cursor advancement as explicit outcome data and add focused assertions around the non-advancing branches if current tests do not already pin them down.
2. Risk: skip/failure bookkeeping could drift across branches during extraction.
   Mitigation: centralize summary/event/cursor updates in small helpers with outcome-specific names.
3. Risk: overlapping assistant-runtime edits could be clobbered.
   Mitigation: keep the change narrow to scanner helpers plus focused tests and preserve adjacent current-file edits.

## Tasks

1. Inspect the current scanner loop and scanner-focused tests to map every branch to its cursor/summary/event behavior.
2. Extract explicit outcome/decision helpers for grouped captures and reply execution.
3. Update or add focused tests that lock in cursor advancement behavior where it is not already covered.
4. Run focused verification for the touched scanner/runtime tests and record exact results.

## Verification

- Focused:
  - `pnpm exec vitest run packages/cli/test/assistant-runtime.test.ts --no-coverage --maxWorkers 1`
- Broader relevant check if needed:
  - `pnpm typecheck`

## Verification results

- `pnpm exec vitest run packages/cli/test/assistant-runtime.test.ts --no-coverage --maxWorkers 1 --configLoader runner` passed (`1` file, `66` tests).
- `pnpm typecheck` failed for pre-existing workspace issues outside this refactor, including `packages/core` TS6305 build-output drift against `packages/contracts/dist/index.d.ts` and unrelated `packages/core/src/bank/providers.ts` typing errors.
- `pnpm --dir packages/cli typecheck` is still blocked by pre-existing workspace `dist` drift (`TS6305` from sibling package outputs), but a focused rerun filtered for touched files produced no remaining diagnostics from `packages/cli/src/assistant/automation/scanner.ts` or `packages/cli/test/assistant-runtime.test.ts`.

## Completion workflow notes

- Simplify pass: no additional behavior-preserving simplifications were warranted after extracting explicit decision/bookkeeping helpers and shared scan-state mutation.
- Test-coverage audit: added one focused regression test that locks the prompt `defer` vs `skip` cursor-advancement split; existing runtime tests already covered reconnectable provider-loss non-advancement and generic failure advancement.
- Task-finish review: no additional correctness or security findings were identified in the touched scanner/test slice after the helper extraction and focused verification.
