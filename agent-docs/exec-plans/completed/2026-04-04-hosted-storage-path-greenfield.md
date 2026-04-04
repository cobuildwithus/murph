# Hosted Storage Path Greenfield

## Goal

Land the supplied hosted storage cleanup intent on the current tree by centralizing opaque hosted storage path builders and keeping the hosted outbox payload storage behavior aligned with the patch intent, while hard-cutting any legacy object-path compatibility because this hosted lane is greenfield.

## Scope

- `apps/cloudflare/src/storage-paths.ts`
- `apps/cloudflare/src/bundle-store.ts`
- `apps/cloudflare/src/execution-journal.ts`
- `apps/cloudflare/src/outbox-delivery-journal.ts`
- `packages/hosted-execution/src/outbox-payload.ts` only if current behavior still misses the patch intent
- Focused hosted Cloudflare tests that cover opaque keys and storage-rotation behavior

## Constraints

- Preserve unrelated dirty worktree edits.
- Do not add legacy read/delete fallbacks for old raw userId/eventId/effectId object keys.
- Keep current key-rotation compatibility through `keysById`.
- Do not regress newer confidentiality choices already present in the live tree.

## Risks

- Hosted storage object-key changes touch encrypted R2 reads/writes and cleanup flows.
- The supplied patch snapshot predates later hosted confidentiality changes, so stale hunks could regress current payload-storage behavior if applied blindly.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Focused scenario proof from the hosted Cloudflare storage-path tests if needed

## Notes

- The current tree already appears to store `device-sync.wake` and `vault.share.accepted` by reference, so only change `packages/hosted-execution/src/outbox-payload.ts` if the live implementation still diverges from the patch intent.
Status: completed
Updated: 2026-04-04
Completed: 2026-04-04
