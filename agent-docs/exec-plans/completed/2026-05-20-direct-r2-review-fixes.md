# Direct R2 Snapshot Review Fixes

## Goal

Land the ReviewGPT follow-up fixes for the hosted workspace direct-R2 snapshot hard cut while preserving the direct-presigned-PUT-only production model.

Success criteria:

- Uploaded snapshot objects are not deleted inline after an ambiguous checkpoint/CAS attempt.
- V2 restore validates tar member paths before extraction.
- Complete binds the uploaded object to HEAD-visible integrity metadata.
- Presigned PUT is minted after local archive/encryption/hash work, close to upload time.
- No test-gated Worker-body v2 upload route remains in the production snapshot path.
- No Worker response-body snapshot restore route remains; restore uses a presigned direct-R2 GET.
- Complete revalidates `idle_shutdown`.
- Abandoned sessions are bounded to one current active upload session per user/write fence.
- The v2 production bridge reads as one snapshot-session protocol, with legacy bundle materialization isolated as compatibility.
- Focused guard coverage protects against artifact sidecar writes and Worker body upload route regression.
- Focused Cloudflare/runtime checks pass; broader repo checks are run or any unrelated blockers are explicitly isolated.

## Scope

Primary files:

- `apps/cloudflare/src/runtime-bridge-workspace.ts`
- `apps/cloudflare/src/runner-outbound.ts`
- `apps/cloudflare/src/runtime-platform.ts`
- `apps/cloudflare/src/r2-presigned-url.ts`
- `apps/cloudflare/src/workspace-snapshot-local.ts`
- `apps/cloudflare/src/workspace-snapshot-store.ts`
- `apps/cloudflare/src/legacy-workspace-snapshot-materialization.ts`
- `packages/assistant-runtime/src/hosted-runtime/platform.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-restore.ts`
- focused tests under `apps/cloudflare/test/**`

## Constraints

- Preserve unrelated dirty Murph Age work.
- Keep direct R2 presigned PUT as the only production upload strategy.
- Do not add multipart, artifact sidecars, hosted-bundle production writes, or Worker snapshot body fallback.
- Keep legacy restore and materialization as compatibility only; do not delete legacy readers during this migration window.
- Do not persist presigned URLs or plaintext data keys.
- Do not expose local paths, raw payloads, secrets, user ids, provider payloads, or direct personal identifiers.

## Verification

- Focused Cloudflare tests around snapshot upload/restore/presign.
- `pnpm --dir apps/cloudflare typecheck`
- `pnpm --dir packages/assistant-runtime typecheck`
- Hosted-local direct-R2 e2e if runtime changes warrant it and time permits.
- `pnpm verify:repo` unless still blocked by unrelated dirty Murph Age work.
Status: completed
Updated: 2026-05-20
Completed: 2026-05-20
