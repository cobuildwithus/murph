# 2026-04-04 Root-Key Recipient AAD Hardening

## Goal

Tighten hosted wrapped root-key recipient AAD so new recipient ciphertext binds both the envelope owner and the envelope root-key identity without breaking existing envelopes.

## Scope

- `packages/runtime-state/src/hosted-user-keys.ts`
- `apps/cloudflare/src/user-key-store.ts`
- `apps/web/src/lib/hosted-execution/browser-user-keys.ts`
- Focused hosted root-key tests under `apps/cloudflare/test/**` and `apps/web/test/**`

## Constraints

- Preserve backward compatibility for already-stored recipient ciphertext.
- Keep the route payload and envelope schema stable unless a minimal metadata marker is needed for compatibility handling.
- Keep scope to hosted root-key recipient crypto only; do not broaden into unrelated hosted execution changes.
- Preserve unrelated dirty-tree edits.

## Plan

1. Add a narrow shared marker/helper for strengthened root-key recipient AAD binding.
2. Bind `userId` and `rootKeyId` into new recipient wrap/unwrap AAD on the Cloudflare and browser paths.
3. Preserve legacy recipient readability through an explicit compatibility path rather than breaking existing envelopes.
4. Add focused tests, run required verification, and close the plan with a scoped commit.

## Verification

- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/user-key-store.test.ts`
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-execution-browser-user-keys.test.ts`
- `pnpm --dir apps/web lint`
- `pnpm test`
- `pnpm typecheck`
- `pnpm test:coverage`

## Status

- Complete
Status: completed
Updated: 2026-04-04
Completed: 2026-04-04
