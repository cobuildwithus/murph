# Prompt Cache Repro

## Goal

Diagnose the latest hosted AI Gateway export showing zero prompt-cache tokens and reproduce the failing resumed-turn accounting locally.

Success criteria:

- New gateway export rows are correlated with hosted usage ledger rows.
- Local tests reproduce the resumed Codex token-usage shape that causes wrong cache/input accounting.
- Usage extraction records the current provider request instead of a thread-cumulative value.
- Verification covers the extractor and the local live repro harness.

## Constraints

- Preserve unrelated hosted onboarding edits and active ledger rows.
- Do not print provider credentials, local account paths, raw prompts, or direct personal identifiers.
- Keep changes scoped to assistant provider usage extraction, tests, and this plan.

## Plan

1. Classify the new gateway export and DB usage rows.
2. Reproduce the resumed-turn token usage shape locally.
3. Fix extractor behavior for thread-cumulative resumed usage.
4. Add focused tests for the observed shape.
5. Run focused verification, typecheck, and completion audit.

## Verification

- Focused static Vitest suite passed:
  `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/provider-registry-helpers.test.ts test/assistant-codex-runtime.test.ts test/codex-thread-instructions.test.ts test/assistant-codex-real-e2e.test.ts`.
- Opt-in live Codex resume cache probe passed with `MURPH_RUN_REAL_CODEX_E2E=1`, `MURPH_REAL_CODEX_MODEL_PROVIDER=vercel-ai-gateway`, and `MURPH_REAL_CODEX_MODEL=openai/gpt-5.5`.
- Package typecheck passed: `pnpm --dir packages/assistant-engine typecheck`.
- Package tests passed: `pnpm --dir packages/assistant-engine test`.
- Diff hygiene passed: `git diff --check`.
- Privacy scan passed for scoped changed files.

## Handoff Notes

- Gateway export rows with zero cached tokens correlate with hosted usage rows whose extracted usage included restored/cumulative thread usage.
- Local live repro shows provider cache can hit for stable resumed Codex prompts; the accounting bug was caused by a restored pre-output `thread/tokenUsage/updated` snapshot, not by missing Codex `prompt_cache_key`.
- The extractor now ignores resumed token-usage snapshots before current-turn model output and preserves total-delta accounting across actual current-turn model responses.

Status: completed
Updated: 2026-05-04
Completed: 2026-05-04
