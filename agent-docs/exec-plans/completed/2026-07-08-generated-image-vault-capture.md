# Generated Image Vault Capture

## Goal

Persist assistant-generated images as canonical vault capture media so Murph can reuse the exact image later, including generated group-chat avatars.

## Constraints

- Use existing capture/raw media primitives; do not add assistant-runtime state or a new image catalog.
- Keep hosted provider URLs delivery-only; Cloudflare Images remains an output transport.
- Do not persist raw prompts, secrets, identifiers, or local filesystem paths in capture metadata.
- Preserve current hosted upload and local generated-image behavior where possible.

## Plan

1. Save validated generated image bytes through `core.addCapture` when a vault root is available.
2. Return the vault-relative capture image ref from generated-image and generated-avatar tool results.
3. Update focused tests for hosted image generation and group avatar generation.
4. Update durable docs for generated image persistence.
5. Run focused tests, typecheck, and scoped commit.

## State

Complete; pending archival by `scripts/finish-task`.

## Verification

- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-generate-image-tool.test.ts test/assistant-codex-group-tool.test.ts test/generate-image-tool.test.ts`
- `pnpm typecheck`
- `pnpm test:diff ARCHITECTURE.md agent-docs/product-specs/captures.md packages/assistant-engine/src/assistant-codex/dynamic-tools.ts packages/assistant-engine/src/assistant-codex/generate-image-tool.ts packages/assistant-engine/test/assistant-codex-generate-image-tool.test.ts packages/assistant-engine/test/assistant-codex-group-tool.test.ts packages/assistant-engine/test/generate-image-tool.test.ts`
Status: completed
Updated: 2026-07-08
Completed: 2026-07-08
