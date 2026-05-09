# Experiment Onboarding Vault-First Rule

## Goal

Make experiment onboarding require a vault-first read across relevant available data before asking setup questions, so Murph does not ask redundant questions about labs, wearables, notes, saved context, active experiments, or other already-available evidence.

Also make lab-backed experiment setup distinguish baseline evidence, such as an already uploaded lipid panel, from the run baseline or pre-intervention window produced by protocol defaults. The assistant should not imply those are the same baseline.

## Scope

- `packages/assistant-engine/src/assistant/system-prompt.ts`
- Focused assistant prompt tests
- `agent-docs/product-specs/experiment-onboarding.md`
- Protocol onboarding guidance for lab-backed Health Commons protocols, if needed

## Constraints

- Preserve safety-screen behavior: high-caution safety questions may still be asked even when the vault is silent.
- Do not add new persisted state or broaden vault authority.
- Keep the rule prompt-level and spec-level unless tests reveal a missing deterministic read surface.
- Preserve unrelated dirty Cloudflare work and existing ledger rows.

## Plan

1. Tighten the assistant experiment onboarding prompt with a pre-question vault-read rule.
2. Add focused prompt assertions for labs, wearables, notes, active experiments, and missing-evidence behavior.
3. Audit the current `vault-cli experiment start|edit` surface for baseline-window versus baseline-evidence support.
4. Tighten assistant/protocol/spec wording so lab evidence and run baseline windows are named separately, and setup summaries explain both.
5. Run focused verification, required audits, and the scoped commit path.

## Verification

- Passed: `pnpm --dir packages/assistant-engine exec vitest run test/model-behavior.test.ts`
- Passed: `pnpm --dir packages/assistant-engine typecheck`
- Passed: `pnpm --dir packages/health-commons typecheck`
- Passed: `pnpm --dir packages/health-commons exec vitest run test/catalog.experiment-onboarding.test.ts`
- Passed: `pnpm typecheck`
- Passed after rerun: `packages/assistant-runtime` focused retry for the transient `hosted-runtime-workspace-entrypoint.test.ts` temp-directory cleanup failure.
- Blocked: `pnpm test:diff packages/assistant-engine/src/assistant/system-prompt.ts packages/assistant-engine/test/model-behavior.test.ts agent-docs/product-specs/experiment-onboarding.md` widened to the CLI suite, then was stopped after unrelated long-running CLI test timeouts.
- Known unrelated red: `pnpm --dir packages/health-commons test` failed in `test/runtime.test.ts` because the tracked generated compact biomarker browse index lacks the expected `sleep-quality` route.
Status: completed
Updated: 2026-05-09
Completed: 2026-05-09
