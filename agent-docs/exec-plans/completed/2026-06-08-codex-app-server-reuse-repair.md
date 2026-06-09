# Repair Codex app-server reuse and resume invariants

Status: completed
Created: 2026-06-08
Updated: 2026-06-09

## Goal

- Repair concrete Codex app-server reuse regressions introduced by the warm
  process simplification, while preserving the simple one-slot architecture.

## Success criteria

- Resumed Codex threads receive the current non-instruction execution context
  needed to avoid stale model/provider/cwd/sandbox/approval behavior.
- Aborted app-server turns cannot leave the single warm slot permanently busy
  when Codex fails to emit a terminal turn event after interrupt.
- Warm launch identity docs match the implemented child-env hashing invariant.
- Focused assistant-engine tests and required repo verification pass or any
  unrelated blockers are documented precisely.

## Scope

- In scope:
- `packages/assistant-engine` Codex app-server request/runtime code and tests.
- `packages/assistant-engine/src/assistant-codex/config.ts` default model/provider
  resolution for app-server turn context.
  - Documentation corrections for the Codex warm-process invariant.
- Out of scope:
  - Broad Codex lifecycle rewrites, multiple warm process slots, or hosted
    runtime ownership changes outside direct regression proof.

## Constraints

- Technical constraints:
  - Keep one shared warm app-server slot per Node runtime/container.
  - Keep prompt text, session ids, and turn ids out of process env.
  - Do not resend bootstrap instructions on native resume unless explicitly
    proven necessary.
- Product/process constraints:
  - Preserve unrelated dirty files and active ledger lanes.
  - Do not expose local usernames, home paths, secrets, or raw credentials.
  - Prefer deletion/small direct fixes over new managers or broad abstractions.

## Risks and mitigations

1. Risk: Fixing resume context by re-sending full prompt instructions could
   duplicate bootstrap behavior.
   Mitigation: Send only the execution context fields Codex exposes for resume.
2. Risk: Abort cleanup could kill a process that is still completing normally.
   Mitigation: Use a bounded cleanup timer only after caller abort and clear it
   as soon as a terminal turn/process event wins.

## Tasks

1. Confirm current app-server request and abort code paths.
2. Patch resume context propagation.
3. Patch bounded abort cleanup for missing terminal events.
4. Add targeted regression coverage.
5. Run focused tests, typecheck, required audits, and close the plan.

## Decisions

- Reuse repair should stay in the existing app-server primitive rather than
  adding another identity layer or process manager.
- Native resume should carry current execution context but not re-send Murph
  bootstrap instructions.
- Config-backed model/provider defaults should be resolved before each turn and
  passed through thread RPC, not folded into warm process launch identity.
- Provider table authority under `[model_providers.*]` is launch-affecting and
  should restart the app-server when it changes under the same provider id.

## Verification

- Commands to run:
  - Focused assistant-engine Codex app-server runtime tests.
  - `pnpm typecheck`.
  - Additional `pnpm test:diff` or package coverage lane if required by the
    final touched-file set.
- Expected outcomes:
  - Focused regressions pass.
  - Typecheck passes or an unrelated pre-existing blocker is documented.

## Progress

- Patched `thread/resume` params to include current cwd, model/provider,
  sandbox, and approval policy.
- Resolved current config-backed model/provider defaults before app-server
  thread/start and thread/resume RPC, including a regression for config changes
  across a warm resumed process.
- Added provider-table launch identity and resume thread-id validation
  regressions from final review.
- Added bounded abort cleanup so a missing terminal event after interrupt
  rejects and poisons the active warm process instead of leaving the slot busy.
- Updated focused tests and durable warm-process docs.
- Focused `assistant-codex-runtime.test.ts` now passes, including the new abort
  timeout and resume-context regressions.
- Verification passed:
  - `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts test/assistant-codex-runtime.test.ts --no-coverage`
  - `pnpm --dir packages/assistant-engine typecheck`
  - `pnpm --dir packages/assistant-engine test:coverage`
  - `pnpm docs:drift`
- Repo-level `scripts/workspace-verify.sh test:diff ...` and `pnpm typecheck`
  are blocked by unrelated dirty `scripts/supplement-db-brand-site-labels.test.ts`
  type errors around possibly undefined `ingredientRows`.
Completed: 2026-06-09
