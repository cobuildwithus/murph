# Recover legacy game photos and inline history delivery

Status: completed
Created: 2026-10-31
Updated: 2026-10-31

## Goal

- Restore readable legacy game images and let history cards fetch their small
  rendition directly, preserving stable media identities and viewer authority.

## Success criteria

- Real synthetic legacy envelopes recover through existing Web crypto and upload.
- History capabilities follow media-route authorization and remain optional.
- Signing is deduplicated and bounded; focused tests and requested checks pass.

## Scope

- In scope: Web media recovery, history response decoration, focused proof.
- Out of scope: app changes, production access, Cloudflare calls, commits,
  pushes, dispatches, PRs, and deployments.

## Constraints

- Reuse existing crypto and Worker endpoints; no schema, queue, service, or key changes.
- Leave changes uncommitted. Preserve history selection and all visibility filters.

## Risks and mitigations

1. Legacy data/key may be missing: fail closed, retain encrypted source, and
   omit optional capabilities when delivery fails. No production recovery claim.
2. Authorization changes: call the same authorizeMediaRead before each distinct
   key, after history filters. No shared capability cache.
3. Fanout: latest game per person only, at most 300 distinct keys, four chains
   at once. Normal path one Worker call/key; recovery at most four.

## Tasks

1. Trace historical storage, key ownership, deletion and current delivery.
2. Add Web-owned lazy recovery and optional avatar capabilities for history.
3. Verify real synthetic crypto, route bounds and database-backed visibility.
4. Run typecheck and complexity, inspect the diff and document deployment limits.

## Decisions

- Worker lacks the control-domain member keys; Web still owns openGameMedia.
  Existing legacy reads plus putGameImage avoid new crypto plumbing entirely.
- Retain legacy ciphertext for retries/rollback. Existing upload owns hash
  validation, concurrent pointer election and account-deletion fencing.
- Reuse GameEntryView.delivery for history's avatar rendition (300 seconds).
- Sign latest-game card previews only; an optional clarification was offered
  because signing every retained game could require 15,000 normal Worker calls.
- UX Outcome: recovered photos and direct card downloads. Reaches: authorized
  players, with reports/blocks/withdrawals hidden and local/error fallback intact.
  Proof: synthetic encrypted bytes, HTTP responses and local PostgreSQL journeys.
- No public changelog publication in this local-only, unshipped task; record the
  member-visible recovery when preparing its release.

## Verification

- Hydration: frozen install, workspace package build, Web Prisma generation.
- Focused Web media/routes and PostgreSQL history tests; existing Worker image
  store tests validate the reused hash, retry and deletion boundaries.
- `pnpm install --frozen-lockfile`, `pnpm build`, and
  `pnpm --dir apps/web prisma:generate`: exit 0.
- Isolated local PostgreSQL database prepared with
  `pnpm --dir apps/web exec prisma migrate deploy`: exit 0. No production access.
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage
  apps/web/test/game-media.test.ts apps/web/test/game-routes.test.ts`: exit 0,
  64 tests. The initial run exited 1 on a Buffer-versus-Uint8Array assertion;
  the corrected assertion checks actual bytes and the rerun passes.
- `MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config
  apps/web/vitest.workspace.ts --no-coverage
  apps/web/test/game-service-postgres.test.ts -t 'history'`, with an explicit
  isolated loopback DATABASE_URL: exit 0, 4 history tests, 45 unrelated skipped.
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts
  --no-coverage apps/cloudflare/test/game-image-store.test.ts
  apps/cloudflare/test/game-media-store.test.ts`: exit 0, 27 image-store tests.
  The legacy store has no separate file in this selection.
- `pnpm typecheck`: exit 0, full workspace including Web and Worker.
- `pnpm complexity:diff`: exit 0, four source files, no hotspots over 20.
- `git diff --check`: exit 0.
- UX review: Ready for local handoff. Synthetic crypto and real local SQL prove
  recovery and viewer filters; route tests prove optional wire shape, unchanged
  mediaUrls, failures/local fallback, deduplication and maximum-cardinality calls.
- Parent review: existing Worker hash validation, concurrent pointer election,
  owner binding and deletion fencing are reused unchanged and covered by tests.
- Unverified: production object/key presence, actual CDN fetch/latency, native
  rendering, deployment and external review. No production or provider calls,
  commits, pushes, PRs, or dispatches were made.
- Deployment: Web only, against the already-existing Worker routes. No schema,
  Worker runtime or key rollout. App consumption can follow the Web deploy.
- Film strip/recap: recovery applies through their existing media requests;
  inline signing is left unchanged because those collections need separate bounds.
Completed: 2026-10-31
