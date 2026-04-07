# Remove the hosted live share-pack read surface

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Remove the remaining web/control-plane read API for hosted share packs so Cloudflare-backed pack objects are write-only at share creation time and delete-only after import completion or release.

## Success criteria

- `apps/web` no longer exposes `readHostedSharePackObject(...)` or `getSharePack(...)`.
- The Cloudflare internal share-pack route no longer accepts `GET /internal/users/:userId/shares/:shareId/pack`.
- Hosted share page/status reads remain fully satisfied from durable Postgres metadata and do not depend on live Cloudflare pack objects.
- Runner-side share import hydration still reads the opaque share pack directly from Cloudflare storage immediately before import.
- Focused share tests pass, required repo verification is run and recorded, and architecture/docs state the write/delete-only rule.

## Scope

- In scope:
- `apps/web/src/lib/hosted-share/pack-{client,store}.ts`
- `apps/cloudflare/src/{index.ts,worker-routes/internal-user.ts,share-store.ts}`
- focused share-route and share-service tests under `apps/web/test/**` and `apps/cloudflare/test/**`
- durable docs describing hosted share-pack ownership and route surface
- Out of scope:
- changing the runner-side share-pack hydration path used during `vault.share.accepted`
- changing the share-pack storage format or retention rules
- changing hosted share preview metadata shape or share acceptance business rules

## Constraints

- Technical constraints:
- Preserve unrelated dirty-tree edits in overlapping hosted files.
- Keep the runner trust boundary intact: only Cloudflare worker/runtime code may read share packs at import time.
- Remove only the live web/control-plane read seam; do not weaken fail-closed behavior when a pack is missing during runner hydration.
- Product/process constraints:
- Treat the internal route contraction as a trust-boundary change and update durable docs in the same turn.
- Run required repo verification, direct proof, and the repo-mandated final audit review before handoff.

## Risks and mitigations

1. Risk: a hidden web/status path still depends on the deleted read seam.
   Mitigation: trace every `readHostedSharePackObject`, `getSharePack`, and internal `GET /shares/:shareId/pack` reference before editing; keep only runner-local storage reads.
2. Risk: route contraction could accidentally remove the worker-owned storage read used for runner hydration.
   Mitigation: leave `createHostedShareStore().readSharePack()` in the Cloudflare runner path and contract only the public/internal HTTP read branch.
3. Risk: docs could continue advertising the removed read route and reintroduce it later.
   Mitigation: update `ARCHITECTURE.md`, `apps/cloudflare/README.md`, and any share-surface wording in the same change.

## Tasks

1. Remove the web share-pack read helpers and the Cloudflare `GET /shares/:shareId/pack` route behavior.
2. Keep worker-local storage reads only in the runner hydration path and share-store tests.
3. Update focused hosted share and Cloudflare route tests for the contracted API.
4. Update architecture/docs to state the write/delete-only share-pack rule.
5. Run required verification, final audit review, and scoped commit.

## Decisions

- Cloudflare-backed hosted share-pack objects are no longer an inspectable control-plane resource; they are transient import-time inputs only.
- The authoritative read model for hosted share pages and status remains the tiny durable Postgres preview/lifecycle summary.

## Verification

- Commands run:
- `pnpm typecheck`
- `pnpm test:coverage`
- `pnpm --dir apps/web lint`
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-share-service.test.ts --no-coverage`
- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/index.test.ts -t "stores and deletes hosted share packs on the signed direct worker route without exposing reads" --no-coverage`
- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/node-runner.test.ts -t "ignores hosted web env when importing a runner-hydrated share pack" --no-coverage`
- Outcomes:
- `apps/web` focused share-service proof passed.
- Cloudflare worker-route proof passed for `PUT`, blocked `GET`, and storage-backed `DELETE`.
- Runner-hydration proof passed for the remaining worker-local share-pack import path.
- `pnpm --dir apps/web lint` passed with pre-existing warnings only.
- `pnpm typecheck` and `pnpm test:coverage` failed on unrelated existing workspace errors under `packages/core/src/vault.ts` and `packages/assistant-engine/src/usecases/{integrated-services,workout-measurement,workout-model}.ts`; this task did not touch those files.
Completed: 2026-04-07
