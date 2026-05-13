# Codex Runtime Naming Cleanup

## Goal

Collapse the remaining assistant provider-generic runtime naming that now wraps
only Codex execution into Codex-specific modules and internal identifiers.

Success criteria:

- Codex-only assistant runtime files use Codex-specific filenames.
- Internal turn-planning and runtime identifiers use Codex thread/continuity
  names instead of provider-session names where doing so is behavior-preserving.
- Persisted compatibility fields and external diagnostic event names are not
  changed unless the current code already treats them as non-contractual.
- Tests and static guards refer to the new module names.

## Constraints

- Naming and import cleanup only; do not mix in logic changes.
- Preserve existing dirty worktree edits in hosted/web/runtime/Murph Age lanes.
- Do not rename unrelated device/channel provider identifiers.
- Preserve redaction, secret, transcript, and path privacy behavior.

## Plan

1. Map current assistant provider-generic modules and call sites.
2. Rename Codex-only modules and update imports/mocks/static guards.
3. Rename local/internal Codex continuity identifiers where safe.
4. Run focused assistant-engine verification plus required repo checks.
5. Run required completion reviews and commit scoped cleanup if safe.

## Verification

- `pnpm --dir packages/assistant-engine typecheck` passed.
- `pnpm --dir packages/assistant-runtime typecheck` passed.
- `pnpm --dir packages/hosted-execution typecheck` passed.
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-failures.test.ts test/assistant-codex-runtime.test.ts test/assistant-automation-support.test.ts test/codex-seams.test.ts test/codex-hard-cut-contract.test.ts` passed.
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-events.test.ts` passed.
- `pnpm --dir packages/hosted-execution exec vitest run --config vitest.config.ts --no-coverage test/hosted-execution-observability-side-effects.test.ts` passed.
- `pnpm --dir packages/assistant-engine test` passed.
- `pnpm --dir packages/assistant-runtime test` passed.
- `pnpm --dir packages/hosted-execution test` passed.
- Later pass after the provider-state cleanup was layered on top: `pnpm typecheck`
  passed.
- Later pass after the provider-state cleanup was layered on top:
  `bash scripts/workspace-verify.sh test:diff <assistant/codex runtime, hosted execution, assistant runtime, CLI test, and completed-plan paths>`
  passed.

## Handoff Notes

- Base naming cleanup was committed by the user at `b6f05c87d`.
- Follow-up audit fixes harden loggable Codex thread diagnostics to presence
  booleans and preserve legacy hosted diagnostic key compatibility.
- Live active-plan references to the renamed helper test now point at
  `packages/assistant-engine/test/codex-runtime-helpers.test.ts`.

Status: completed
Updated: 2026-05-13
Completed: 2026-05-13
