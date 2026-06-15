# Hosted Codex Flex Catalog Patch

## Goal

Make hosted Codex turns for `gpt-5.5` actually send OpenAI `service_tier: flex`, then enable the existing model-specific `openai-flex` token pricing basis for production usage rows.

## Context

- Direct OpenAI Responses API accepts `model: "gpt-5.5"` with `service_tier: "flex"`.
- The pinned Codex catalog rejects flex for `gpt-5.5`, so Codex app-server drops the tier before sending the provider request.
- Billing must stay fail-closed: flex pricing is allowed only for models whose provider request path sends flex.

## Scope

- Hosted runner final image patches the bundled Codex model catalog on top of the installed Codex CLI.
- Assistant-engine launch passes a `model_catalog_json` config override when the runner image exposes the catalog path.
- Cloudflare smoke config writers use the same catalog path.
- Hosted cron e2e asserts the production-like scheduled reminder path uses flex and records `openai-flex` pricing.

## Verification

- Focused assistant-engine and hosted-execution tests for config/pricing helpers.
- Focused Cloudflare hosted-local scheduled reminder e2e when feasible.
- Typecheck and repo-required completion checks before handoff.

## State

- Implemented the runner-image Codex catalog patch and platform-owned runtime env plumbing.
- Implemented model/provider-gated `openai-flex` token pricing for `gpt-5.5`.
- Added prod-faithful Codex app-server and hosted-local scheduled reminder proof.
- Completion audits ran; coverage added Dockerfile `jq` filter proof, and the deep-review smoke-env gap was fixed by preserving the image-owned catalog env in runtime/smoke projection.
- Current next step: rerun affected-file verification after the smoke-env fix, then finish the plan commit.
Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
