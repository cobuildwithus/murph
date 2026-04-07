## Goal

Land the supplied hard cut that makes `apps/web` `execution_outbox` delivery-only, moves post-handoff lifecycle ownership into the Cloudflare Durable Object queue and committed-result recovery lane, and replaces the remaining web-owned share-import finalize work with a signed internal callback owned by Cloudflare finalize logic.

## Success Criteria

- `apps/web` `execution_outbox` uses only `queued`, `dispatching`, `dispatched`, and `delivery_failed`, with no web-owned accepted/completed/failed timestamps or lifecycle completion logic.
- `apps/cloudflare` applies any required hosted-web business-outcome callback before consuming a committed event and can retry that finalize step from the committed recovery lane without handing ownership back to Postgres.
- The hosted share-import completion path runs through a signed internal web callback and Cloudflare-owned finalize recovery rather than the hosted web outbox drain.
- Shared hosted-execution contracts/docs reflect the new ownership model truthfully.
- Verification covers the touched hosted web and Cloudflare surfaces as far as the environment allows, with any blockers recorded explicitly.

## Scope

- `apps/web/prisma/**`
- `apps/web/src/lib/hosted-execution/**`
- `apps/web/src/lib/hosted-share/**`
- `apps/web/app/api/internal/hosted-execution/share-import/complete/**`
- `apps/cloudflare/**`
- `packages/hosted-execution/**`
- `ARCHITECTURE.md`
- hosted durable docs/READMEs touched by this seam

## Constraints

- Treat the supplied patch as intent, not overwrite authority; preserve adjacent current-tree edits.
- Preserve unrelated dirty worktree edits, especially the existing hosted-web test changes already present before this task.
- This is a high-risk hosted storage/retry/trust-boundary change, so docs and verification must move with the code.
- The user already warned that existing dev databases need reset/recreate because the baseline Prisma schema and init migration are being hard-cut in place.

## Verification

- `pnpm typecheck`
- `pnpm test:coverage`
- `pnpm --dir apps/web lint`
- direct focused hosted-web and Cloudflare checks for the touched seam if repo-wide commands are blocked or too slow to localize failures
- at least one direct scenario-oriented proof for the delivery-only/finalize-retry path, or an explicit gap if full runtime proof is unavailable here

## Notes

- The supplied patch mostly applies cleanly; current drift was detected in `ARCHITECTURE.md` and must be merged manually against newer wording.
- Expect test updates if current hosted suites still assume the removed web-owned outbox lifecycle.
- `pnpm` wrapper commands became unavailable for this branch because current workspace manifests no longer match the committed lockfile; verification used the already-installed local `vitest`/`tsc` binaries directly instead of mutating dependencies.
- Direct proof covered the delivery-only web outbox routes/tests plus Cloudflare durable finalize recovery and the removed outbound finalize route.
Status: completed
Updated: 2026-04-07
Completed: 2026-04-07
