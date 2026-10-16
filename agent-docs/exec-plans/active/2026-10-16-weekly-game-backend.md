# Weekly game backend MVP

Status: active
Created: 2026-10-16
Updated: 2026-10-16

## Goal

- Ship the private 1v1 weekly game backend dark in `apps/web` so the MurphV2
  iOS prototype can play a real game end to end against a local stack.

## Success criteria

- One write path (`runGameCommand`) under a game row lock, with pure rules and
  viewer-scoped reads that never leak another player's locked entry.
- `/api/game/v1` resource routes and the `/g/<token>` invite page work against
  a local stack; games settle on read; dev time travel returns 404 in real
  production.
- Focused rule, view, route, schema, and Postgres tests pass; typecheck and lint
  pass; PR evidence guards pass.

## Scope

- In scope: seven additive tables and one migration, rules, service, routes,
  local-disk media, invite page and its presentation study, product spec, and
  architecture entry.
- Out of scope: groups, league, Murph host tools, declining or cancelling
  invites, hosted media storage, EXIF stripping, recaps, bankruptcy, and any
  production enablement.

## Constraints

- Technical constraints: short database-only transactions with encryption
  before them; additive schema only; no new infrastructure.
- Product/process constraints: off in production unless `MURPH_GAME_ENABLED`
  is set, then limited by `MURPH_GAME_MEMBER_ALLOWLIST`; synthetic fixtures only.

## Risks and mitigations

1. Risk: another player's locked entry leaks through a read.
   Mitigation: views omit the whole entry until the viewer posts; route tests
   assert no entry id, media key, text, or data appears.
2. Risk: two invites go live for the same person concurrently.
   Mitigation: unique `game_player.active_member_id`, set only at go-live.

## Tasks

1. Contract, schema, and migration.
2. Rules, time, views, and the service write path.
3. HTTP resource routes, content-addressed media, invite page.
4. Docs, design proof, PR evidence, final ReviewGPT.

## Decisions

- Build in the public web app; murph-cloud has no HTTP API that verifies app
  sessions.
- Plain unique columns instead of partial indexes, so `prisma db push` local
  stacks keep the guarantees.
- Data-model review findings folded in: bounded retakes counting withdrawn
  posts, permanent unlock, count-mode shortfall misses, honor-rule grace with a
  stored day, result frozen on the game, fill-only label copy, stake keys.
- Resource routes over one internal command union; one validator at the
  service boundary.
- Deletions after review: no circle (rematches chain through
  `previous_game_id`, the game carries its round), no request-id dedupe (every
  write is keyed by its ids or state), no settle cron (due-ness comes from
  state; reads settle), content-addressed media, photo and excuse entries only,
  no profile photos, no decline or cancel. `game_event` stays as a plain
  history that nothing reads yet.

## Verification

- Commands to run: `pnpm exec vitest run --config apps/web/vitest.config.ts`
  on the `game-*` tests (the Postgres suite with `MURPH_TEST_POSTGRES_CONCURRENCY=1`
  and a migrated loopback `murph_test_*` `DATABASE_URL`), `pnpm typecheck`,
  lint, `pnpm complexity:diff`, docs drift, and the PR evidence guards.
- Expected outcomes: all pass; the local API smoke plays create, accept, post,
  unlock, withdraw, retake, settle, redeem, and rematch.
