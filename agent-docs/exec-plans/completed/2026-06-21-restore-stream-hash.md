# Restore Stream Hash

## Goal

Hash hosted workspace snapshot encrypted bytes during restore decryption instead
of reading the encrypted object once only for SHA-256 before decrypting it.

## Scope

- `apps/cloudflare/src/workspace-snapshot-local.ts`
- focused restore tests in `apps/cloudflare/test/workspace-snapshot-local.test.ts`

## Constraints

- Keep encrypted object size, SHA-256, AES-GCM tag, plaintext archive SHA-256,
  tar safety, and scratch cleanup fail-closed.
- Do not move decrypted output outside restore scratch before all integrity and
  archive safety checks pass.
- Preserve the direct-R2 v2 snapshot contract and legacy restore behavior.

## Verification Plan

- Focused Cloudflare workspace snapshot tests.
- `pnpm typecheck`.
- `pnpm test:diff` scoped to touched files if it truthfully covers the app slice.

## Completion

- Required security/privacy, coverage, and deep-review audit passes.
- Close this plan with `scripts/finish-task`.
Status: completed
Updated: 2026-06-21
Completed: 2026-06-21
