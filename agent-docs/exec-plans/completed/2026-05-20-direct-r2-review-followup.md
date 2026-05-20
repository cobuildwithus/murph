# Direct-R2 Snapshot Review Follow-Up

## Goal

Close final ReviewGPT/subagent findings on the hosted workspace direct-R2 snapshot hard cut without reintroducing fallback upload paths or extra architecture.

Success criteria:

- V2 snapshot complete cannot publish objects at or above the single-part guard.
- Complete verifies object existence and encrypted size through HEAD without streaming the object through the Worker.
- Session state keeps presigned URLs and plaintext data keys out of Durable Object storage.
- Deploy docs/preflight/redaction and account-data cleanup reflect the R2 presign/snapshot namespace contract.
- Repo checks and hosted-local E2E pass.

## Constraints

- Keep production upload kind `direct-r2-presigned-put` only.
- No Worker-body snapshot route, no 96 MiB cap, no multipart, no artifact sidecars for v2.
- Preserve unrelated dirty work.
- Do not expose local paths, personal identifiers, secrets, raw snapshot bodies, or presigned URLs.

## Working Set

- `apps/cloudflare/src/**`
- `apps/cloudflare/test/**`
- `apps/cloudflare/scripts/**`
- `apps/cloudflare/DEPLOY.md`
- `.github/workflows/deploy-cloudflare-hosted.yml`
- `packages/runtime-state/README.md`
- hosted-local direct-R2 E2E verification

## State

Status: completed
Created: 2026-05-20

## Progress

- Pushed the direct-R2 hard cut in commit `9f37df5ed`.
- ReviewGPT through the open Brave tab has repeatedly stalled after starting the GitHub connector pass.
- Current follow-up patches keep the architecture unchanged and close account-data deletion, diagnostic redaction, stale legacy-doc wording, upload-session retirement, pre-complete abort, and restore guard test gaps.
- `pnpm verify:repo` passed.
- `pnpm test:e2e:hosted-local` passed, including the direct-R2 presigned PUT scenario.
Updated: 2026-05-20
Completed: 2026-05-20
