# Security Audit Hardening

## Goal

Apply the watched ChatGPT security-audit encryption hardening patch where it cleanly matches the current repo, keeping scope limited to token escrow binding, hosted encrypted-record ownership validation, and strict hosted encryption payload decoding.

## Scope

- `packages/device-syncd/src/crypto.ts`
- `packages/device-syncd/src/service.ts`
- `packages/assistant-runtime/src/hosted-device-sync-runtime.ts`
- `apps/cloudflare/src/user-key-store.ts`
- `apps/cloudflare/src/device-sync-runtime-store.ts`
- `apps/web/src/lib/device-sync/crypto.ts`
- Focused regression tests under the touched owners if needed to cover the returned behavior

## Constraints

- Treat the downloaded patch as intent, not overwrite authority.
- Keep the diff scoped to the returned encryption hardening only.
- Preserve compatibility for existing local legacy device-sync ciphertext reads unless the artifact explicitly removes that path.
- Preserve existing hosted storage and runtime contracts outside the added validation.
- Run repo-required verification after implementation and note any unrelated blockers separately.

## Planned Shape

1. Bind local device-sync token encryption/decryption to explicit purpose and account context, with structured ciphertext parsing and legacy fallback.
2. Propagate the same token-binding rules through hosted runtime hydration and export paths.
3. Fail closed on mismatched hosted encrypted-record ownership and malformed hosted encryption key/payload input.
4. Update only the targeted tests needed to cover the new behavior.

Status: completed
Updated: 2026-04-15
Completed: 2026-04-15
