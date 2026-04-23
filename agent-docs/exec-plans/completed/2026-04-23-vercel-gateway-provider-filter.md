# Vercel Gateway Provider Filter

## Goal

Add a clean hosted assistant configuration seam for Vercel AI Gateway provider filtering so production can restrict `openai/gpt-5.4` routing to the `openai` provider and avoid Azure-backed attempts.

## Constraints

- Keep the existing `HOSTED_ASSISTANT_PROVIDER` / `HOSTED_ASSISTANT_MODEL` config shape intact.
- Do not hardcode this behavior for every Gateway use; make it explicit env/config.
- Do not print or persist provider secrets.
- Preserve unrelated dirty work already present in the checkout.

## Plan

1. Inspect the current hosted assistant config parsing and OpenAI-compatible provider option shaping.
2. Add a narrow env/config field for Vercel Gateway `only` providers.
3. Thread it into `providerOptions.gateway.only` only for Vercel AI Gateway targets.
4. Add focused parser/provider-option tests.
5. Run targeted verification and commit only the scoped diff.

## Result

- Added `HOSTED_ASSISTANT_GATEWAY_ONLY_PROVIDERS` as an explicit Vercel AI Gateway-only provider filter.
- Threaded the normalized provider slugs through hosted assistant config, persisted provider targets, session options, provider execution, and Responses request shaping.
- Forwarded the env var through Cloudflare worker contracts, deploy automation, and the hosted deployment workflow.
- Verified with `pnpm typecheck`, `pnpm test:diff`, and scoped whitespace/privacy checks.
Status: completed
Updated: 2026-04-23
Completed: 2026-04-23
