# Final Integration / Agent 11

Integrate the full greenfield hosted cutover.

Worker rules:

- You are the final implementation worker in a parent-orchestrated `codex-workers` flow.
- This lane runs in the sibling repo clone on clean `main`, after Batch 1 and Batch 2 have already been merged locally by the parent agent.
- `AGENTS.md` and the repo workflow docs apply in full.
- You may touch the whole repo only for final merge resolution, dead-code deletion, docs alignment, and verification after the earlier batches are already merged.
- Do not edit the active execution plan or worker-pack files.
- Do not create commits, run `scripts/committer`, run `scripts/finish-task`, push, or launch nested workers/subagents.
- You may run broad verification because this final pass is the merged proof lane, but leave repo completion audits and the final commit/push to the parent orchestrator.
- Before writing, read the current file state carefully and preserve adjacent edits.
- In your final report, list: final architecture summary, owner table, deleted-seams table, exact verification results, blockers or likely merge-back risks.

Owned scope:

- whole repo, but only for final merge resolution, dead-code deletion, docs alignment, and verification after Batch 1 and Batch 2 are already merged locally

Mission:

Turn the merged batch work into one coherent final architecture with no duplicate ownership left behind.

Required outcomes:

1. Resolve cross-batch conflicts cleanly.
2. Delete dead code, dead routes, dead helpers, dead tests, dead docs, dead env/config references.
3. Ensure the final architecture is actually true in code:
   - `apps/web` / Postgres canonically owns hosted member identity/routing/billing/email auth/share facts and dispatch lifecycle
   - `apps/cloudflare` owns only execution coordination plus opaque encrypted runtime blobs
   - no staged dispatch payload control plane remains
   - no generic Cloudflare user-env control plane remains
   - no Cloudflare-owned share-pack durable seam remains
   - no Cloudflare-owned canonical device-sync runtime seam remains
   - no Cloudflare-owned broad pending-usage store remains
   - no separate durable gateway authority remains in Cloudflare
   - crypto provisioning happens in one activation-time path only
4. Update durable docs to match final reality:
   - `ARCHITECTURE.md`
   - `docs/architecture.md`
   - `apps/web/README.md`
   - `apps/cloudflare/README.md`
   - any small reference/proof docs that would otherwise lie
5. Run broad verification and report truthfully:
   - `pnpm typecheck`
   - `pnpm verify:acceptance`
   - if needed, app-local verify commands for `apps/web` and `apps/cloudflare` while debugging
6. Produce a final owner table with three buckets:
   - canonical
   - derived/projection
   - transient/internal
7. Produce a final deleted-seams table listing every removed route/store/helper/contract family.

Required grep/proof checks before declaring done:

- no surviving `storeDispatchPayload` / `dispatchStoredPayload` / `deleteStoredDispatchPayload` helpers
- no surviving Cloudflare share-pack control client usage
- no surviving verified-email sync into hosted user env
- no surviving `provisionManagedUserCrypto` control-plane helper outside the one activation path
- no surviving Cloudflare pending-usage user-list route
- no surviving dedicated durable `gateway.state` authority unless it is only a cache/projection over workspace snapshot state
- no surviving broad Cloudflare user-env CRUD route surface

Style rules:

- prefer deletion over aliasing
- no TODO-based ownership ambiguity
- no compatibility shims
- fail closed
