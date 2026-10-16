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
- `/api/game/v1` routes, the `/g/<token>` invite page, and the settle cron work
  against a local stack; dev time travel returns 404 in real production.
- Focused rule, view, route, schema, and Postgres tests pass; typecheck and lint
  pass; PR evidence guards pass.

## Scope

- In scope: eight additive tables and one migration, rules, service, routes,
  local-disk media, invite page and its presentation study, product spec, and
  architecture entry.
- Out of scope: groups, league, Murph host tools, hosted media storage, EXIF
  stripping, recaps, bankruptcy, and any production enablement.

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
3. HTTP routes, media, settle cron, invite page.
4. Docs, design proof, PR evidence, final ReviewGPT.

## Decisions

- Build in the public web app; murph-cloud has no HTTP API that verifies app
  sessions.
- Plain unique columns instead of partial indexes, so `prisma db push` local
  stacks keep the guarantees.
- Data-model review findings folded in: bounded retakes counting withdrawn
  posts, permanent unlock, count-mode shortfall misses, honor-rule grace with a
  stored day, result frozen on the game, fill-only label copy, stake keys.

## Verification

- Commands to run: `pnpm exec vitest run --config apps/web/vitest.config.ts`
  on the `game-*` tests (with `MURPH_GAME_TEST_DB_URL` for the Postgres suite),
  `pnpm typecheck`, lint, docs drift, and the PR evidence guards.
- Expected outcomes: all pass; the local API smoke plays create, join, post,
  unlock, settle, and redeem.
