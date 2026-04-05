# Device-Sync Escrow Cutover

## Goal

Make Cloudflare the canonical owner of decryptable hosted device-sync token escrow while keeping Prisma limited to public connection metadata and token-audit history.

## Why this plan exists

- Batch 2 requires a hard cut from web-global decryptable device token rows to the existing Cloudflare runtime store seam.
- The live tree already contains Batch 1 storage/runtime changes, so this lane must port onto current code rather than the original planning snapshot.
- The work crosses Cloudflare control contracts, hosted web device-sync flows, and Prisma storage policy.

## Constraints

- No legacy compatibility readers, writers, env vars, or payload shims.
- Reuse `apps/cloudflare/src/device-sync-runtime-store.ts`; do not add a second secret store.
- Preserve unrelated dirty worktree edits and stay out of share/onboarding lanes unless a shared contract forces it.
- Do not add passkey, user-unlock, Vault/OpenBao, OIDC, or TEE work.
- `HOSTED_CONTACT_PRIVACY_KEY` remains allowed because it is not a general decryptable secret domain.

## Intended changes

1. Extend hosted-execution control/client contracts so web can read and apply device-sync runtime state through signed Cloudflare control routes, not just mirror snapshots.
2. Update Cloudflare worker and Durable Object surfaces to support canonical runtime snapshot reads and apply mutations for the bound user.
3. Refactor hosted web device-sync connection, agent export/refresh, disconnect, and wake paths to use Cloudflare as canonical token escrow while Prisma keeps metadata plus token-audit rows only.
4. Remove Prisma-owned canonical decryptable device-sync secret storage from the schema and focused tests.

## Verification target

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- `pnpm --dir apps/web lint`
- Focused direct proof from the updated device-sync tests covering Cloudflare-owned apply/read and Prisma metadata-only behavior.

## Outcome

- Implemented signed Cloudflare read/apply routes on the existing runtime-store seam and switched hosted web device-sync token ownership to Cloudflare.
- Removed Prisma-owned canonical decryptable device-sync secret storage; Postgres now retains public metadata plus token-audit history.
- Updated durable architecture/control-plane docs to describe the new ownership boundary.

## Verification outcome

- Direct typecheck passed for `packages/hosted-execution`, `apps/cloudflare`, and `apps/web` via `tsc -p`.
- Focused tests passed for hosted-execution contracts, Cloudflare worker device-sync control routes, and the updated web device-sync suites.
- `pnpm --dir apps/web lint` passed with warnings only.
- Repo-level `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage` remain blocked in this sandbox by `tsx` IPC `EPERM` failures; `pnpm test:coverage` also hits Wrangler log/socket permission failures in the broader Cloudflare suite.
Status: completed
Updated: 2026-04-05
Completed: 2026-04-05
