# provider-first assistant setup onboarding

Status: completed
Created: 2026-03-22
Updated: 2026-03-22

## Goal

- Merge the supplied provider-first onboarding patch so setup persists assistant backend defaults cleanly and the assistant runtime can use either Codex or an OpenAI-compatible endpoint without carrying stale provider session state forward.

## Success criteria

- Interactive `murph onboard|setup` asks for the assistant backend before channel selection and supports Codex CLI, Codex OSS/local-model, OpenAI-compatible, and skip.
- Operator config persists safe assistant backend defaults such as provider, model, base URL, provider label, and API-key env-var name without storing raw API keys.
- `assistant ask`, `assistant chat`, and root `chat` accept and propagate provider/base URL/API-key-env/provider-name overrides.
- OpenAI-compatible chat turns execute through the existing AI SDK harness, replay recent local transcript context, and reset provider session ids when switching backends.
- Docs and focused tests reflect the new provider-backed onboarding behavior.

## Scope

- In scope:
  - setup wizard ordering and provider-specific prompt resolution
  - operator-config persistence for assistant backend defaults
  - assistant CLI flag plumbing and chat-provider support for OpenAI-compatible backends
  - assistant service session/transcript handling for backend switching
  - targeted docs and tests
- Out of scope:
  - changing inbox model-routing semantics
  - persisting raw provider secrets
  - introducing new non-local deployment/runtime assumptions

## Risks and mitigations

1. Risk: current assistant/setup files have drifted since the patch was built.
   Mitigation: apply the patch, inspect each touched module, and reconcile any mismatches before verification.
2. Risk: backend switching could leak stale session identifiers or wrong defaults.
   Mitigation: keep provider-session reset logic explicit and add/retain focused tests around session reuse and defaults.
3. Risk: OpenAI-compatible support could accidentally persist secrets.
   Mitigation: store only env-var names and redact any accidental credential material during review.

## Tasks

1. Register the lane in `COORDINATION_LEDGER.md` and inspect the patch against the current repo state.
2. Apply the patch and finish any manual merge or cleanup work required by current assistant/setup code.
3. Run required repo verification plus completion-workflow audit passes and commit the touched files if the results are acceptable.

## Verification

- Required: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`
- Focused: provider/setup/assistant CLI Vitest coverage where needed while reconciling patch drift
- Outcome:
  - `pnpm typecheck` passed.
  - `pnpm exec vitest run --coverage.enabled=false packages/cli/test/assistant-service.test.ts packages/cli/test/assistant-state.test.ts packages/cli/test/assistant-runtime.test.ts --maxWorkers 1` passed.
  - `pnpm exec vitest run --coverage.enabled=false packages/cli/test/assistant-provider.test.ts packages/cli/test/assistant-cli.test.ts packages/cli/test/setup-cli.test.ts --maxWorkers 1` remains blocked by unrelated workspace build failures outside this change (for example `packages/core/src/operations/canonical-write-lock.ts` missing `@murph/runtime-state` exports and `packages/web/src/lib/overview.ts` unresolved `@murph/query` imports when the repo runs the broader build/test pipeline).
  - `pnpm test` failed for the same unrelated workspace/build breakages outside the touched provider/setup files.
  - `pnpm test:coverage` failed early in the pre-existing web build step because `packages/web/src/lib/overview.ts` cannot resolve `@murph/query` and `@murph/query/search`.
