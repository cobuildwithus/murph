# Responses-first hosted assistant runtime

Status: completed
Created: 2026-04-13
Updated: 2026-04-13

## Goal

- Remove the dedicated `gateway` execution driver from hosted assistant runtime selection.
- Converge OpenAI and Vercel AI Gateway hosted assistant flows on one `responses` execution driver.
- Keep Vercel Gateway as a provider preset and request-policy layer for Responses requests, including zero-data-retention support.

## Success criteria

- Runtime contracts expose a single hosted assistant Responses driver instead of separate `openai-responses` and `gateway` drivers.
- The `openai` and `vercel-ai-gateway` presets both resolve to the unified Responses driver.
- Assistant-engine request construction preserves existing resume, `store: false`, and compaction behavior while allowing Gateway request metadata to be injected for Vercel Responses calls.
- Existing generic OpenAI-compatible fallback behavior remains intact for non-Responses providers.
- Required tests cover the collapsed runtime shape and pass.

## Scope

- In scope:
  - `packages/operator-config/**` runtime-contract and provider-resolution changes for the unified Responses driver.
  - `packages/assistant-engine/**` model-harness and provider-option changes for the unified Responses path.
  - Focused test updates in touched owner packages.
- Out of scope:
  - Broad provider preset redesign beyond the hosted runtime collapse.
  - New external provider support work unrelated to the Responses-first shape.

## Constraints

- Preserve direct OpenAI Responses behavior, including auto-compaction injection.
- Preserve the user-facing `vercel-ai-gateway` preset.
- Do not reintroduce a second hosted assistant conversation transport just to preserve legacy structure.
- Preserve unrelated worktree edits.

## Risks and mitigations

1. Risk: The OpenAI SDK Responses provider does not first-class forward `providerOptions.gateway`.
   Mitigation: Keep Murph-owned request augmentation at the fetch/body layer, and make that the single place where Gateway-specific request metadata is added for Vercel Responses calls.

2. Risk: Collapsing runtime drivers changes config/runtime seams and test expectations across packages.
   Mitigation: Update contract tests and engine tests together, then verify with truthful owner coverage.

3. Risk: The active OpenRouter gateway-driver investigation overlaps these files.
   Mitigation: Treat this refactor as the exclusive runtime-driver lane and avoid mixing in unrelated OpenRouter behavior changes.

## Tasks

1. Update runtime contracts and runtime-target resolution to expose a single hosted `responses` execution driver.
2. Collapse assistant-engine model/provider handling onto the unified Responses path while preserving compaction and Gateway policy injection.
3. Update tests for runtime resolution, provider options, and model harness behavior.
4. Run required verification and audit passes.

## Decisions

- Hosted assistant runtime will be Responses-first: Gateway is a preset/policy layer, not a distinct execution driver.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test:diff packages/operator-config packages/assistant-engine`
- Expected outcomes:
  - Typecheck passes.
  - Diff-aware coverage for the touched owner packages passes with the unified Responses runtime.
Completed: 2026-04-13
