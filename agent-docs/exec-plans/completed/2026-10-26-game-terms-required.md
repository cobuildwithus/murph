# Game writes wait for Murph's current Terms behind a flag

Status: completed
Created: 2026-10-26
Updated: 2026-10-26

## Goal

- A Terms version bump makes game players agree again before they start,
  accept, or play a game. Today the game's HTTP door checks only sign-in and
  the invite-only access rule, so players keep playing on an old acceptance.

## Success criteria

- With `MURPH_GAME_REQUIRE_CURRENT_TERMS=true`, create, accept, negotiate,
  post, propose a change and mark a prize done return `403 TERMS_REQUIRED`
  until `launch.legal` is current; the refusal names the scope's documents and
  versions, and accepting those versions unblocks the same write.
- Reads, reports, blocks, the profile, and withdrawing a member's own post,
  invite or change are never refused for the Terms.
- Unset or any other value: identical behavior to today, and no consent read.

## Scope

- In scope: `apps/web/src/lib/game/http/{auth,command-route,errors}.ts`, the
  error code in `contract.ts`/`rules.ts`, route and PostgreSQL tests, the spec
  and consent docs.
- Out of scope: live legal documents, the real Terms version, Vercel env,
  health-data consent, game moves made in Murph's chat (they don't pass the
  HTTP door), and the iOS client (murph-ios, separate PR).

## Constraints

- Technical constraints: additive `/api/game/v1` change; old app builds see an
  ordinary non-retryable refusal, so the flag stays off until a build that
  handles `TERMS_REQUIRED` ships.
- Product/process constraints: no new consent UI on the web; copy has no em
  dashes.

## Risks and mitigations

1. Risk: a background or safety write (report, block, take back) gets stuck
   behind the Terms.
   Mitigation: an explicit allow-by-omission set of gated command types, with
   route tests that every other write stays open with no grant at all.
2. Risk: the flag accidentally on for old clients.
   Mitigation: only the exact string `true` enables it; tests cover `""`,
   `"1"`, `"false"` and `"TRUE"` as off.

## Tasks

1. Gate the listed command types in `respondToGameCommand` behind the flag.
2. Carry `scope` and `documents` in the refusal.
3. Route tests (flag off, on, open writes) and a PostgreSQL proof that agrees
   through the companion consent route with the refusal's versions.
4. Document in the weekly game spec and the legal consent implementation doc.

## Decisions

- `TERMS_REQUIRED` (not `TERMS_CHANGED`, which is a game's own terms) at 403.
- The profile is not gated: the app syncs the time zone from a refresh, and
  that background write must never stop on the Terms.

## Verification

- Commands to run: `pnpm exec vitest run --config apps/web/vitest.config.ts
  --no-coverage apps/web/test/game-*.test.ts` with an isolated migrated
  `murph_test_*` database and `MURPH_TEST_POSTGRES_CONCURRENCY=1`;
  `pnpm --dir apps/web typecheck`; `pnpm complexity:diff`; `pnpm docs:drift`.
- Expected outcomes: all pass.
- Outcomes: 41 game/legal files, 626 tests passed (6 skipped); typecheck,
  oxlint, complexity and docs drift clean. Local self-play on a lane-owned
  hosted-local stack (fixtures +1 555 555 0901/0902): flag on, new members are
  asked before create and accept, agree with the refusal's versions, then play;
  after a local Terms version bump a post is refused while home, the game, a
  report and the profile stay open, agreeing lets the same entry post, and the
  other player is asked at their next post; flag off, both stale members post
  and create as before. ReviewGPT round 1 (vonneumann, GPT-6 Pro): PASS.
Completed: 2026-10-26
