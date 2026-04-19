## Title

Close the stale coalesced-wake commit hole by invalidating stale cursor CAS tokens on in-place coalescing rewrites.

## Goal

Ensure a runner that fetched an older version of a coalesced hosted wake cannot later advance the canonical cursor for that same seq after web rewrites the unresolved row in place.

## Scope

- `apps/web/src/lib/hosted-wake/{store-append,store-data}.ts`
- `apps/web/test/hosted-wake-store.test.ts`
- narrow durable docs for the hosted wake fence if the behavior contract changes materially

## Constraints

- Keep queue correctness web-owned; do not add Cloudflare-owned correctness state.
- Preserve the current fetch-proof and terminal-receipt contract surface unless a narrower fix is impossible.
- Avoid schema changes unless they are strictly necessary.
- Preserve adjacent hosted-wake event-identity and payload work already in flight.

## Verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/hosted-wake/store-append.ts apps/web/src/lib/hosted-wake/store-data.ts apps/web/test/hosted-wake-store.test.ts`

## Notes

- The chosen fence should satisfy the cutover guide's stale-result and latest-wins intent for coalesced rewrites.
- If the existing cursor `version` can serve as that fence, prefer it over adding a second persisted revision token.
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
