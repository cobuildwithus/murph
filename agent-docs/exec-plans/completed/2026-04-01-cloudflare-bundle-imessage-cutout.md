# Prevent iMessage SDK from entering Cloudflare worker bundle

Status: completed
Created: 2026-04-01
Updated: 2026-04-01

## Goal

- Keep the hosted Cloudflare worker bundle from statically pulling in the iMessage SDK so Wrangler does not fail on `bun:sqlite` during deploys, while preserving local iMessage send behavior.

## Success criteria

- `packages/assistant-core/src/assistant/channels/runtime.ts` no longer statically imports `@photon-ai/imessage-kit`.
- Focused proof covers the new runtime-only iMessage loading path.
- Required verification for the touched surface passes or any unrelated pre-existing failures are explicitly separated.

## Scope

- In scope:
- Narrow change to iMessage runtime loading, Cloudflare worker email-parsing imports, and focused regression coverage for both bundle edges.
- Out of scope:
- Broader channel-adapter refactors, delivery-behavior changes, or unrelated bundle cleanup.

## Constraints

- Technical constraints:
- Hosted Cloudflare builds must no longer resolve Bun-only modules from the iMessage SDK path.
- Product/process constraints:
- Treat this as a high-risk deploy-surface change: keep the diff narrow, run required checks, and complete the required review pass before commit.

## Risks and mitigations

1. Risk: A lazy-load change could break local iMessage delivery if constructor loading semantics change.
   Mitigation: Keep the public `sendImessageMessage` behavior intact and add focused regression coverage for dependency injection and runtime-loading behavior.

## Tasks

1. Replace the static iMessage SDK import with runtime-only loading inside the iMessage send path.
2. Add focused regression proof for the new loading path.
3. Run required verification for the touched surface.
4. Run the required final review and create a scoped commit.

## Decisions

- Fix the bundle at both reachable edges:
- `packages/assistant-core` now runtime-loads `@photon-ai/imessage-kit` so local iMessage delivery does not force a static dependency edge.
- `apps/cloudflare` now imports inbox email parsing from the email-only inboxd subpath so the worker entry does not traverse the inboxd root barrel that re-exports the iMessage connector.

## Verification

- `pnpm exec vitest run packages/cli/test/assistant-channel.test.ts --no-coverage`
- `pnpm --dir apps/cloudflare verify`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- `pnpm exec vitest run packages/cli/test/assistant-channel.test.ts --no-coverage` passed.
- `pnpm --dir apps/cloudflare verify` passed, and the prior `bun:sqlite` bundle warning no longer appeared.
- `pnpm typecheck` passed.
- `pnpm test` failed in unrelated existing areas:
- `packages/cli/test/assistant-service.test.ts`
- `packages/core/test/profile.test.ts`
- `packages/inboxd/test/inboxd.test.ts`
- `pnpm test:coverage` failed in the same unrelated existing areas:
- `packages/cli/test/assistant-service.test.ts`
- `packages/core/test/profile.test.ts`
- `packages/inboxd/test/inboxd.test.ts`
Completed: 2026-04-01
