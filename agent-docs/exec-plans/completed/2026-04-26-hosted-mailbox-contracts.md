# Hosted Mailbox Contract Gate

## Goal

Start the hosted runtime hard cut with additive shared contracts for the
greenfield mailbox/checkpoint/runner shape, while leaving the current run
protocol in place until later phases delete its call sites.

Success criteria:

- `@murphai/hosted-execution` exposes mailbox, workspace, runtime-log, and
  runner nudge/status contracts that can be explained without `runId`,
  committed sequence targets, turn-input adoption, or finalize semantics.
- `@murphai/cloudflare-hosted-control` can express the web-to-Cloudflare
  runner nudge/status boundary without adding new run-shaped result fields.
- Parser tests prove the new contracts reject malformed lane, log, checkpoint,
  and plaintext-like log payload shapes.
- The first slice stays additive and does not wire the new contracts into the
  still-active runtime, web schema, or Cloudflare runner implementation.

## Constraints

- Preserve unrelated dirty work in the shared checkout.
- Avoid files owned by active assistant-runtime and Cloudflare runner rows.
- Do not delete old run contracts in this slice; later migration phases own the
  destructive cut once callers move.
- Do not log or fixture secrets, message text, provider payloads, contact
  identifiers, local filesystem paths, or decrypted vault content.
- Keep package imports through declared public entrypoints.

## Working Set

- `packages/hosted-execution/src/**`
- `packages/hosted-execution/test/**`
- `packages/cloudflare-hosted-control/src/**`
- `packages/cloudflare-hosted-control/test/**`
- Direct package docs only if required by the contract surface

## State

Implemented and focused-verified. This slice is the Phase 1 serial contract
gate from `migration.md`; it intentionally avoids runtime behavior and Durable
Object storage changes.

Completed:

- Added additive mailbox, workspace checkpoint, runtime-log, and runner
  nudge/status contracts plus parsers under `@murphai/hosted-execution`.
- Added hosted runtime internal route constants and package export coverage for
  the new contract surface.
- Added Cloudflare runner nudge/status route and client helpers without
  changing the legacy run helpers still used by active callers.
- Updated the directly owned package READMEs so the future target is nudge /
  mailbox / checkpoint instead of run acquire / commit / finalize.

Focused verification:

- `pnpm --dir packages/hosted-execution typecheck`
- `pnpm --dir packages/cloudflare-hosted-control typecheck`
- `pnpm --dir packages/hosted-execution test:coverage`
- `pnpm --dir packages/cloudflare-hosted-control test:coverage`
- `pnpm test:smoke`

Known external blockers:

- Root `pnpm typecheck` is blocked by unrelated active checkout drift in
  `packages/assistant-runtime`: one workspace-boundary import guard finding and
  one hosted-share type error.
Status: completed
Updated: 2026-05-02
Completed: 2026-05-02
