# Venice Provider Hardening

Goal (incl. success criteria):
- Fix the follow-up Venice onboarding/provider issues found by review: Codex provider override shape, standalone model picker provider persistence, assistant provider env readiness/CTA, reserved provider handling, and setup-time provider key scoping.
- Success means Venice remains a registry-backed Codex Responses provider, future providers use the same simple seams, provider API keys are not forwarded to unrelated setup subprocesses, and focused tests prove the regressions.

Constraints/Assumptions:
- Keep the Codex App Server hard cut. Do not add a direct Venice runtime.
- Preserve the local secret boundary: raw provider keys are never logged, committed, written into Codex config overrides, or forwarded to unrelated host/tool provisioning subprocesses.
- Keep hosted Venice fail-closed. Do not widen hosted allowlists or runner env forwarding.
- Favor one provider registry seam over provider-specific branches when the change is small and directly reduces drift.
- Preserve unrelated dirty work and active ledger rows.

Key decisions:
- Emit Codex provider override paths with safe bare provider ids, not quoted dotted path segments.
- Keep provider-specific runtime troubleshooting as provider metadata so future providers do not add Codex adapter branches.
- Thread `assistantModelProvider` through standalone `murph model` wizard setup options.
- Represent assistant-provider missing env beside the assistant setup result and include it in setup CTA output.
- Split setup env overrides into persistence/assistant values and a scrubbed env passed to host provisioning.
- Keep serialized assistant session/default surfaces to stable target fields; resolve provider registry metadata at runtime boundaries.
- Force Codex shell env default secret exclusions for known API-key provider runs via scalar config override.
- Keep existing custom `modelProvider` values readable, while requiring registered Murph-emitted provider config ids to fit Codex dotted-path `--config` overrides.
- Expose API-key provider onboarding through full setup only; standalone `murph model` keeps threading returned provider selections but does not render Venice as full key onboarding.
- Keep provider registry metadata out of broad provider/session DTOs; resolve provider config only at setup/status/Codex execution boundaries.
- Redact Codex failure text, including exact selected-provider secret values, before appending provider-specific hints.

State:
- completed

Done:
- Review findings collected from four subagents.
- Fixed Codex override serialization for Venice and reserved providers.
- Fixed standalone `murph model` provider threading and stale provider clearing.
- Fixed `skip` plus Codex-specific option conflicts.
- Scrubbed all registered assistant provider credential keys from setup provisioning envs.
- Added provider shell env policy override so Codex tool shells filter `*KEY*`, `*SECRET*`, and `*TOKEN*` variables.
- Added `requires_openai_auth=false` to emitted custom Codex provider tables.
- Added noninteractive provider-key fail-closed behavior before setup persistence/provisioning.
- Removed derived `modelProviderConfig` from serialized session/default outputs while keeping runtime registry resolution.
- Removed derived `modelProviderConfig` from assistant provider target/runtime DTOs.
- Added strict model-provider resolution for session option serialization and Codex launch while keeping tolerant config normalization for read/migration boundaries.
- Exported pure setup prompt-key resolution and covered provider-derived prompt keys without terminal I/O.
- Redacted Codex provider failure messages before adding the Venice hint, including bearer tokens, env assignments, and exact provider secret values.
- Added focused regression coverage for setup resolver, model wizard, provider overrides, provider boundary inputs, and secret sentinels.

Now:
- Archived after implementation commit.

Next:
- None for this plan.

Open questions (UNCONFIRMED if needed):
- `pnpm review:gpt` is unavailable in this checkout; `pnpm exec cobuild-review-gpt --help` works, but the repo script requested by the user has been removed.

Working set (files/ids/commands):
- `packages/operator-config/src/assistant/target-runtime.ts`
- `packages/operator-config/src/assistant-cli-contracts.ts`
- `packages/operator-config/src/setup-runtime-env.ts`
- `packages/operator-config/src/assistant/provider-config.ts`
- `packages/setup-cli/src/setup-assistant-wizard.ts`
- `packages/setup-cli/src/setup-cli.ts`
- `packages/setup-cli/src/setup-services.ts`
- `packages/setup-cli/src/setup-wizard-app.ts`
- `packages/setup-cli/src/setup-wizard.ts`
- `packages/cli/src/commands/model.ts`
- `packages/assistant-engine/src/assistant/providers/helpers.ts`
- `packages/assistant-engine/src/assistant/providers/codex-cli.ts`
- Focused tests in `packages/*/test/**`
- Verification passed:
  - `pnpm --dir packages/operator-config typecheck`
  - `pnpm --dir packages/setup-cli typecheck`
  - `pnpm --dir packages/assistant-engine typecheck`
  - `pnpm --dir packages/cli typecheck`
  - `pnpm --dir packages/setup-cli build`
  - `pnpm --dir packages/assistant-engine build`
  - `pnpm --dir packages/operator-config build`
  - `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/assistant-cli.test.ts packages/cli/test/setup-cli.test.ts`
  - `pnpm --dir packages/assistant-runtime test -- --run test/package-entrypoints.test.ts test/hosted-assistant-bootstrap.test.ts`
  - focused operator-config/setup-cli/assistant-engine/cli Vitest commands listed in final handoff
- Verification blocked:
  - `pnpm review:gpt --help` because the `review:gpt` command is not registered in this checkout.
  - `pnpm --dir packages/cli test -- --run test/assistant-cli.test.ts test/setup-cli.test.ts` runs the broader CLI workspace through the package wrapper and times out in an unrelated `cli-expansion-document-meal.test.ts`; the direct two-file Vitest invocation passed.
  - `pnpm test:repo-tools -- --run scripts/dev-hosted-local/stack.test.ts scripts/hosted-local.test.ts` runs the wider repo-tools suite and fails on unrelated existing repo-tool checks: the Cloudflare hosted-local bespoke script assertion and runtime-state source-alias assertion.
- Committed as `8f88ff190` (`Add Venice Codex provider onboarding`).
Status: completed
Updated: 2026-05-07
Completed: 2026-05-07
