# Local Hosted Dev Lane

## Goal

Add one repo-root local-dev entrypoint that stands up the hosted web and Cloudflare worker together for local end-to-end testing.

## Scope

- Add a root `pnpm dev` orchestration command.
- Make localhost hosted web -> Cloudflare dispatch work without local HTTPS-only friction.
- Document the required one-time local inputs for the hosted lane.

## Constraints

- Preserve unrelated dirty work in `apps/web`.
- Do not weaken non-loopback hosted execution URL validation.
- Keep the local lane aligned with the existing Vercel env + Cloudflare `.dev.vars` contracts instead of inventing a second secret source.

## Verification

- Focused hosted-web tests for the dispatch env normalization.
- Truthful diff-aware verification for touched owners.
- Direct local startup proof for the new root `pnpm dev` flow.

## Notes

- The current repo already boots `apps/web` locally and supports `wrangler dev`, but there is no root orchestration flow and the web dispatch URL parser still rejects plain loopback HTTP.
Status: completed
Updated: 2026-04-13

## Outcome

- Added repo-root `pnpm dev` orchestration for hosted local dev.
- Root launcher now pulls Vercel development env, fetches a local Vercel OIDC token, normalizes malformed self-prefixed env values, materializes/restores temporary Cloudflare `.dev.vars`, runs Prisma generate plus migrate, and starts both hosted web and local Wrangler/Containers together.
- Local hosted execution dispatch/control now accepts loopback HTTP while still rejecting non-loopback plain HTTP.
- Direct runtime proof:
  - `pnpm dev` now fails fast with a clear port-collision error on occupied default ports.
  - `NEXT_DIST_DIR_MODE=smoke MURPH_DEV_WEB_PORT=3011 MURPH_DEV_WORKER_PORT=8791 pnpm dev` reached `Local hosted dev is ready.` with both web and worker healthy, then cleaned up the generated Cloudflare `.dev.vars` on shutdown.
Completed: 2026-04-13
