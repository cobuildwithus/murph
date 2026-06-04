# Fix hosted Codex defaults CI failure

Status: completed
Created: 2026-06-04
Updated: 2026-06-04

## Goal

- Fix the failing `Murph Host Support` run by aligning hosted Codex runtime
  config with the existing authority hard-cut: hosted model selection must come
  from deploy/operator configuration, not from `packages/assistant-runtime`.

## Success criteria

- The assistant-engine authority hard-cut test passes.
- Hosted Codex runtime config tests still prove explicit model/reasoning
  passthrough and generated TOML behavior.
- Required repo verification for the touched hosted-runtime/assistant-engine
  surfaces passes or any unrelated blocker is documented.

## Scope

- In scope:
  - `packages/assistant-runtime/src/hosted-runtime/codex-config.ts`
  - `packages/operator-config/src/hosted-assistant-config.ts`
  - Focused tests under `packages/assistant-runtime/test/**` and
    `packages/operator-config/test/**`.
  - The existing `packages/assistant-engine/test/codex-authority-hard-cut.test.ts`
    invariant.
- Out of scope:
  - Changing hosted provider selection, credentials, egress policy, or Codex
    launch topology.
  - Reworking the authority hard-cut test beyond the failing invariant.

## Constraints

- Technical constraints:
  - Do not reintroduce Murph-owned hosted Codex model defaults.
  - Preserve explicit env passthrough for model/reasoning/sandbox/approval.
  - Keep hosted model credential validation fail-closed.
- Product/process constraints:
  - Preserve repo privacy rules and avoid committing direct identifiers.
  - Use the active-plan finish path for commit/plan closure.

## Risks and mitigations

1. Risk: Removing the runtime fallback could surface missing upstream config in
   existing tests.
   Mitigation: Fix the upstream test env/setup path rather than adding another
   fallback in assistant-runtime.

## Tasks

1. Inspect the failing CI log and contract test.
2. Remove hosted Codex model fallback ownership from assistant-runtime and
   hosted operator bootstrap.
3. Update focused tests only if they were depending on the removed fallback.
4. Run focused checks, required audits, and final verification.
5. Close the plan and create a scoped commit.

## Decisions

- Treat the user's failing run request as approval to implement the focused CI
  fix in the current checkout.
- Restore the pre-existing ownership split for hosted model selection: deploy
  preflight/env supplies the model, while assistant-runtime only forwards it
  when present.

## Verification

- Commands to run:
  - `pnpm --dir packages/assistant-engine test -- codex-authority-hard-cut.test.ts`
  - `pnpm --dir packages/assistant-runtime test -- hosted-runtime-codex-config.test.ts`
  - `pnpm typecheck`
  - `pnpm test:diff packages/assistant-runtime/src/hosted-runtime/codex-config.ts packages/assistant-engine/test/codex-authority-hard-cut.test.ts`
- Expected outcomes:
  - Focused tests and required scoped verification pass.
- Completed:
  - `pnpm --dir packages/assistant-engine test -- codex-authority-hard-cut.test.ts` passed.
  - `pnpm --dir packages/assistant-runtime test -- hosted-runtime-codex-config.test.ts` passed.
  - `pnpm --dir packages/operator-config test -- hosted-assistant-bootstrap.test.ts` passed.
  - `pnpm typecheck` passed.
  - `bash scripts/workspace-verify.sh test:diff packages/assistant-runtime/src/hosted-runtime/codex-config.ts packages/assistant-runtime/test/hosted-runtime-codex-config.test.ts packages/operator-config/src/hosted-assistant-config.ts packages/operator-config/test/hosted-assistant-bootstrap.test.ts packages/assistant-engine/test/codex-authority-hard-cut.test.ts` passed.
  - `security-privacy-review` found no concrete security/privacy, authority,
    fail-closed, secret exposure, or external-egress regression. Residual risk:
    direct non-deploy local runtime paths can omit the model and use Codex's own
    default; normal Cloudflare deploy preflight still requires an explicit
    priced production model.
  - `coverage-write` found the current proof sufficient and made no edits. It
    noted the subagent runtime could not guarantee the exact requested model.
  - `task-finish-review` found no code bugs. Its metadata-scope findings were
    accepted and fixed by updating this plan and the coordination ledger.
Completed: 2026-06-04
