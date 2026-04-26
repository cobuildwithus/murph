# Remove Prompt Cache Key Plumbing

## Goal

Remove the provider-specific `promptCacheKey` abstraction introduced with the assistant prompt cache layering work. Keep the stable prompt prefix refactor, deterministic tool schema ordering, and cache-observability metadata that prove the stable prefix is healthy.

## Scope

- Remove `promptCacheKey` and route-signature plumbing from assistant prompt metadata, route planning, provider execution inputs, provider registry forwarding, and OpenAI-compatible provider options.
- Keep `staticPromptHash`, `stableRouteCapabilityPromptHash`, `toolSchemaHash`, and `dynamicContextStartsAfterStaticCore`.
- Keep deterministic assistant tool catalog ordering and hashing.
- Update focused tests to assert stable prompt/hash/boundary behavior without provider-specific cache keys.

## Non-Goals

- Do not change prompt copy or prompt layer boundaries except where required by deleted metadata.
- Do not alter tool availability policy, web/no-web routing, or provider selection.
- Do not add provider cache-control abstractions.

## Verification

- Focused assistant-engine prompt/provider tests.
- `pnpm --dir packages/assistant-engine typecheck`.
- `pnpm --dir packages/assistant-engine test`.
- Root typecheck if the focused package checks pass.
- Diff hygiene check on touched files.
Status: completed
Updated: 2026-04-26
Completed: 2026-04-26
