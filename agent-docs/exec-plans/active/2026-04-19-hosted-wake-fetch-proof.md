## Title

Make hosted wake cursor advancement prove a fetched wake identity instead of trusting caller-supplied seqs.

## Goal

Move hosted wake advancement correctness fully back under `apps/web` ownership by minting web-only fetch proofs for fetched wakes, requiring those proofs on cursor advancement, and keeping snapshot-only bundle CAS updates on the existing cursor-version fence.

## Scope

- `apps/web/src/lib/hosted-wake/**`
- `apps/web/app/api/internal/hosted-wake/{unseen,commit}/route.ts`
- `apps/cloudflare/src/{user-runner.ts,web-control-plane.ts}`
- `packages/hosted-execution/src/{contracts,parsers}.ts`
- focused hosted wake tests in `apps/web`, `apps/cloudflare`, and `packages/hosted-execution`
- minimal hosted web env/docs updates for the proof key

## Constraints

- Keep queue/cursor correctness web-owned; do not add Cloudflare-owned correctness state.
- Preserve snapshot-only cursor CAS updates for pending-cleanup/finalize flows.
- Work on top of the current hosted-wake materialization and payload-unification edits already in flight.
- Avoid schema changes unless they are strictly necessary.

## Verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/hosted-wake/store.ts apps/web/src/lib/hosted-wake/store-projections.ts apps/web/app/api/internal/hosted-wake/unseen/route.ts apps/web/app/api/internal/hosted-wake/commit/route.ts apps/cloudflare/src/user-runner.ts apps/cloudflare/src/web-control-plane.ts packages/hosted-execution/src/contracts.ts packages/hosted-execution/src/parsers.ts apps/web/test/hosted-wake-store.test.ts apps/web/test/hosted-wake-routes.test.ts apps/cloudflare/test/user-runner-hosted-wake.test.ts packages/hosted-execution/test/hosted-wake-parsers.test.ts`

## Notes

- The architectural target is stateless per-wake fetch proof verification in web, not a second persisted queue lease.
- The proof must bind the fetched wake identity tightly enough that Cloudflare cannot advance by supplying only `committedSeq`.
