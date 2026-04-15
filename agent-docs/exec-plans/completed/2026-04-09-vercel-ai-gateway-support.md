# Add first-class Vercel AI Gateway support for Murph assistants

Status: completed
Created: 2026-04-09
Updated: 2026-04-09

## Goal

- Make Vercel AI Gateway a first-class OpenAI-compatible provider choice across Murph's saved assistant defaults and hosted assistant bootstrap.
- Add a clean persisted `zeroDataRetention` option for OpenAI-compatible assistant targets and wire it into assistant execution when the target is Vercel AI Gateway.

## Success criteria

- Setup/model selection recognizes a named Vercel AI Gateway provider preset instead of requiring a fully manual custom endpoint.
- Local and hosted assistant config can persist an optional OpenAI-compatible `zeroDataRetention` flag without breaking existing provider configs.
- Assistant execution sends `providerOptions.gateway.zeroDataRetention = true` when that flag is enabled for a Vercel AI Gateway-backed target.
- Hosted runner env policy can forward the referenced Vercel AI Gateway API key env when configured.

## Scope

- In scope:
- `packages/operator-config/**` provider preset, config, hosted bootstrap, and schema updates
- `packages/assistant-engine/**` execution wiring for gateway-specific provider options
- `packages/setup-cli/**` setup/defaults UX and tests that surface the new preset
- `apps/cloudflare/**` runner env policy/tests for the Vercel AI Gateway key path
- Out of scope:
- unrelated operator-config/setup-cli follow-up extraction work already in progress
- broader provider-management redesign beyond the narrow Vercel gateway and ZDR seam

## Constraints

- Preserve existing config compatibility for saved assistant defaults and hosted assistant profiles.
- Keep the new ZDR behavior explicit and provider-scoped; do not change non-Gateway providers.
- Avoid inventing a second provider abstraction when the existing OpenAI-compatible seam is sufficient.

## Tasks

1. Extend the OpenAI-compatible config/model-target schemas with an optional `zeroDataRetention` flag.
2. Add a named Vercel AI Gateway preset and make setup/hosted bootstrap resolve it cleanly.
3. Wire assistant execution to emit Gateway provider options only for Vercel AI Gateway-backed routes.
4. Update focused tests across operator-config, setup-cli, assistant-engine, and Cloudflare runner env policy.
5. Run required verification, complete the final audit pass, and commit only this lane.

## Verification

- `pnpm typecheck`
- focused package/app tests covering the touched seams
- `bash scripts/workspace-verify.sh test:diff packages/operator-config packages/assistant-engine packages/setup-cli apps/cloudflare`
Completed: 2026-04-09
