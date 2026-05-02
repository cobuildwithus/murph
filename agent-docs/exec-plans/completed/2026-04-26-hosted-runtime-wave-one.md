# Hosted Runtime Wave One

## Goal

Land the next independent seams from `migration.md` after the shared hosted
mailbox contract gate, while preserving the greenfield target: Cloudflare is a
thin per-user runner over local runtime-owned mailbox import, checkpoints,
outbox, and logs.

Success criteria:

- Phase 1 runtime platform ports exist in `packages/assistant-runtime` with fake
  ports in tests and no coupling to hosted-run acquire/commit/finalize.
- Remaining shared semantic side-input contracts are narrow, typed, and
  privacy-bounded in `@murphai/hosted-execution`.
- Web mailbox/workspace storage groundwork is additive, transaction-oriented,
  and avoids turn adoption, run cursors, or web-owned execution state.
- No wave-one slice edits Cloudflare Durable Object runner internals before the
  runtime and web seams are ready.

## Constraints

- Preserve unrelated dirty work in the shared checkout.
- Do not reintroduce web-owned run adoption, run finalization, committed
  sequence targets, or executor queues in new contracts.
- Keep logs and status redacted: no message text, provider payloads, secrets,
  contact identifiers, decrypted vault content, or local filesystem paths.
- Do not import sibling workspace internals; use declared package entrypoints.
- Workers are not alone in the codebase and must not revert edits made by other
  workers or existing active lanes.

## Wave One Ownership

- Worker A: `packages/hosted-execution` semantic side-input contracts and
  parser/tests only.
- Worker B: `packages/assistant-runtime` hosted runtime platform ports and
  fake-port tests only.
- Worker C: `apps/web` additive hosted mailbox/workspace storage groundwork and
  focused tests only.

## State

Focused-verified and superseded by later mailbox/workspace integration waves.
Wave one landed the additive contract, runtime-port, and web storage groundwork
without wiring Cloudflare runner or Durable Object internals.

Completed:

- Added hosted semantic side-input DTOs/parsers/routes in
  `@murphai/hosted-execution` for mailbox payloads, share payload/import,
  device-sync bridge envelopes, usage export, and issue export.
- Added optional hosted `mailboxPort`, `workspacePort`, and `logPort` fields to
  `HostedRuntimePlatform`, with fake-port tests and no new run/adopt/finalize
  semantics.
- Added additive web Prisma models, migration SQL, and focused stores for
  mailbox append/fetch/payload fetch, workspace read/checkpoint CAS, and
  structured runtime logs.
- Kept mailbox item fetch metadata-only; sidecar payload ciphertext is fetched
  through a separate helper.
- Kept web runtime log validation aligned to shared
  `@murphai/hosted-execution/runtime-control` constants.

Deferred:

- Hosted outbox drain and receipt checkpointing.
- Remaining producer migration from old ingress/run tables to mailbox append.
- Final destructive Prisma deletion of old run/ingress/cursor tables.
- Cloudflare Durable Object simplification after the workspace-run path becomes
  the sole nudge/alarm path.

## Verification Targets

- `pnpm --dir packages/hosted-execution typecheck`
- `pnpm --dir packages/hosted-execution test:coverage`
- `pnpm --dir packages/assistant-runtime typecheck`
- Focused assistant-runtime hosted runtime tests selected by Worker B
- Focused apps/web hosted mailbox/workspace tests selected by Worker C
- `pnpm --dir packages/cloudflare-hosted-control typecheck`
- `pnpm --dir packages/cloudflare-hosted-control test:coverage`
- `pnpm test:smoke`

Verification run:

- `pnpm --dir packages/hosted-execution test:coverage`
- `pnpm --dir packages/cloudflare-hosted-control test:coverage`
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-platform.test.ts test/hosted-runtime-platform-greenfield-ports.test.ts --no-coverage`
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-mailbox-schema.test.ts apps/web/test/hosted-mailbox-store.test.ts apps/web/test/hosted-workspace-store.test.ts`
- `pnpm --dir apps/web typecheck`
- `pnpm typecheck`
- `pnpm test:smoke`
- `git diff --check` on the wave-one touched files
Status: completed
Updated: 2026-05-02
Completed: 2026-05-02
