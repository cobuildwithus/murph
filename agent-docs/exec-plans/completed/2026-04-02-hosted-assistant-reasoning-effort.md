# Hosted assistant reasoning effort

Status: completed
Created: 2026-04-02
Updated: 2026-04-02

## Goal

- Preserve `HOSTED_ASSISTANT_REASONING_EFFORT` through the explicit hosted assistant config seam so platform-managed hosted OpenAI-compatible profiles compile into assistant defaults with the requested reasoning effort intact and official OpenAI-hosted runs forward it to the provider.

## Success criteria

- Hosted env parsing continues to accept `HOSTED_ASSISTANT_REASONING_EFFORT`.
- The explicit durable `hostedAssistant` profile preserves that value when it compiles into legacy assistant defaults for runtime compatibility.
- Hosted bootstrap coverage proves that a named OpenAI provider such as `HOSTED_ASSISTANT_PROVIDER=openai` plus `HOSTED_ASSISTANT_MODEL=gpt-5.4` and `HOSTED_ASSISTANT_REASONING_EFFORT=medium` persists the reasoning effort in both durable hosted config and compiled assistant defaults.
- Focused provider execution coverage proves that official OpenAI Responses calls forward `reasoningEffort: "medium"` when the hosted config resolves to the OpenAI endpoint.

## Scope

- In scope:
- Narrow assistant-core propagation fix for hosted `openai-compatible` profiles.
- Narrow OpenAI Responses forwarding fix for the official OpenAI-hosted execution path.
- Focused hosted assistant bootstrap regression coverage.
- Out of scope:
- Broader assistant provider architecture work.
- New provider-specific reasoning controls beyond preserving the existing hosted field.

## Constraints

- Preserve the explicit hosted assistant config seam already landed; do not add a parallel config path.
- Keep the overlap into `packages/assistant-core/src/assistant/**` limited to the minimal provider-config fix needed for the hosted path.
- Preserve unrelated dirty-tree edits and active exclusive architecture work.

## Risks and mitigations

1. Risk: The shared provider-config helper is used outside hosted execution, so a narrow hosted fix could accidentally widen other OpenAI-compatible behavior.
   Mitigation: Keep the change to preserving already-supplied `reasoningEffort` data only, and add focused hosted regression proof instead of a broad refactor.

## Tasks

1. Confirm where `openai-compatible` normalization drops `reasoningEffort`.
2. Preserve `reasoningEffort` through hosted profile creation and compiled assistant defaults.
3. Forward the preserved reasoning effort through official OpenAI Responses execution.
4. Add focused hosted bootstrap and provider execution coverage for `gpt-5.4` plus `medium`.
5. Run required verification, required final review, and scoped commit.

## Decisions

- Keep the implementation on the existing hosted `hostedAssistant -> assistant defaults` compilation seam instead of adding a one-off runtime override.
- Preserve `reasoningEffort` only for hosted profiles that resolve to the official OpenAI endpoint so arbitrary `openai-compatible` endpoints do not accept an inert setting.

## Verification

- Commands to run:
- `pnpm exec vitest run --coverage.enabled false packages/assistant-runtime/test/hosted-assistant-bootstrap.test.ts`
- `pnpm exec vitest run --coverage.enabled false packages/cli/test/assistant-provider.test.ts`
- `pnpm typecheck`
- Expected outcomes:
- Hosted bootstrap coverage proves `reasoningEffort: "medium"` survives the explicit hosted config path for the OpenAI-compatible hosted profile, focused provider coverage proves the official OpenAI path forwards it, and repo typecheck remains green.
- Results:
- Passed: `pnpm exec vitest run --coverage.enabled false packages/assistant-runtime/test/hosted-assistant-bootstrap.test.ts`
- Passed: `pnpm exec vitest run --coverage.enabled false packages/cli/test/assistant-provider.test.ts`
- Passed: `pnpm typecheck`
- Direct proof: a `pnpm exec tsx` scenario confirmed `HOSTED_ASSISTANT_PROVIDER=openai`, `HOSTED_ASSISTANT_MODEL=gpt-5.4`, and `HOSTED_ASSISTANT_REASONING_EFFORT=medium` persist `reasoningEffort: "medium"` in both durable hosted config and compiled assistant defaults.
Completed: 2026-04-02
