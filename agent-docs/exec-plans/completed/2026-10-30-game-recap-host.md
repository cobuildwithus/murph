# Murph hosts the weekly game

Status: completed
Created: 2026-10-30
Updated: 2026-10-30

## Goal

Make Murph host each bound two-player weekly-game room: one selective morning
check-in for a run of missed scheduled days, curated pair lore in the existing
group workspace, and a validated Murph-written recap stored on the canonical
game and returned to both players.

## Success criteria

1. A closed scheduled day with no counting post can reserve one check-in for the
   first date in a consecutive miss run, due around 09:00 in that player's frozen
   game time zone. Off days, open days, self-marked incomplete posts and games
   without an exact bound room reserve nothing.
2. The existing lifecycle and exact-room delivery owners produce at most one
   restart-safe group turn per check-in or settled-game recap. Check-ins may end
   in an explicit no-reply when later conversation already supplied the story.
3. Group turns receive short lore guidance only for a live game in that exact
   room. Murph uses the game-host lore tool to curate a file namespaced by an
   opaque sorted-pair fingerprint, including dated excuses and used bits, at
   roughly 200 lines across games.
4. A recap turn reads the canonical game projection, current group conversation
   history and lore, then calls `write_recap`. The server accepts only the fixed
   page kit, exact game-visible entry ids, verbatim eligible quotes, bounded text,
   and safe score wording; fixable failures preserve the approved messages.
5. The accepted recap is sealed on the existing game row, idempotent for that
   game and room, and exposed as `{ pages, scoreLine, chatLine } | null` in each
   player view. The notice turn delivers the saved `chatLine` exactly through
   the ordinary queued group path and records the same text in the transcript.
6. Older clients retain the existing excuse upload API. No production access,
   real delivery, new table, flag, push, commit, PR, or deployment occurs.

## Existing owners and evidence

- `game`, its row lock, settlement, encrypted text helpers and `GameView` own the
  canonical recap. A nullable sealed column is the smallest durable extension.
- `game_event` plus `HostedLinqDelivery` game-lifecycle receipts own acceptance,
  replay and terminal delivery. The bound `chat_container_member_id`, exact-pair
  roster checks and current block/access predicates remain authoritative.
- Group runtime conversation history already contains accepted room messages;
  investigation will prefer projecting it into the recap turn over adding a
  duplicate message store or read tool.
- Group workspace storage already owns room-local durable files; the dedicated
  lore tool selects the exact pair namespace and adds no database truth.
- The reference validator and prompt establish the approved model-visible kit,
  descriptions and exact correction messages. Production retains `chatLine` in
  `write_recap`; the runtime makes its accepted value the authoritative notice
  reply so validation and delivery cannot diverge.

## Product UX plan

- **Outcome:** missed players get one timely, personal group nudge when useful;
  both players get a specific swipeable story of the finished game; remembered
  jokes improve future turns without becoming a transcript.
- **Entry and promise:** ordinary game settlement or the first missed scheduled
  day reserves work; delivery happens only in the existing bound group. A failed
  or not-yet-written recap remains `null`, preserving the app fallback.
- **Affected journeys:** single and consecutive misses; already-explained misses;
  days off/open/incomplete; players in different time zones; rich and sparse game
  posts; first game without lore and later games with used bits; blocked/unbound
  rooms; invalid first recap tool calls that Murph can correct.
- **Deliberate exclusions:** no 1:1 messages, chat creation/discovery, iOS voice
  screen removal, excuse API removal, new recap rendering, production traffic,
  or historical recap backfill.
- **Proof:** deterministic trigger, prompt, schema, authority, encryption/view,
  group-guidance and retry-message tests; synthetic real-Codex check-in/recap
  journey; focused suites plus all game PostgreSQL suites in a disposable local
  database; typecheck, lint, complexity and requested diff tests.
- **Done when:** each selected journey has an evidence-backed `Ready` result,
  quiet paths stay quiet, the recap is readable by both players only, and every
  invalid or stale external effect fails before delivery or storage.

## Failure, retry and deployment shape

- Stable keys are `game-missed:<gameId>:<memberId>:<firstMissedDate>` and
  `game-recap:<gameId>`. Reservation commits with the owning game transition or
  maintenance read; signaling remains a replayable hint.
- Dispatch revalidates the exact bound room, two-player audience, game/source
  predicate and block/access state. An invalidated receipt is durably skipped.
- `write_recap` retries are model-local within one turn. Only a fully validated
  payload seals; rejected calls do not partially write. A recap turn without an
  accepted save fails before transcript or delivery, while an accepted save
  replaces any model-authored final text with its validated `chatLine`.
- Database transactions remain short and database-only. Decryption, prompt
  construction, model work, workspace reads and provider delivery remain outside.
- Deployment order is strict: apply the compatible nullable schema first; deploy
  runtime consumers that parse the new fail-closed response-policy kinds and
  provide the game-host profiles second; deploy the Web producer that enqueues
  those kinds last. Refresh warm runtimes before enabling the producer by deploy.
- Rollback floor: after Web emits a new recap/check-in policy, runtime may not be
  rolled back below the consumer build until every such mailbox item has drained
  or been retired. The nullable schema remains in place while any deployed code
  references it; schema removal is not part of a rollback. Web may roll back to
  a schema-compatible pre-producer build without rolling back consumers.

## Tasks

1. Trace settlement, lifecycle reservation/drain, group notification context,
   conversation history, workspace tools, game crypto/view and migration tests.
2. Add the nullable recap storage contract, sealed read/write helpers, view field
   and migration compatibility proof.
3. Extend lifecycle reservation and dispatch for missed-run and recap notices,
   preserving exact-room and bounded timing/authority rules.
4. Add production prompt builders, live-game lore guidance and the recap dynamic
   tool with the exact reference schema/descriptions and server validator.
5. Add deterministic tests and one focused production-derived real-Codex journey.
6. Update weekly-game documentation, replay Product UX journeys, inspect the full
   uncommitted diff for privacy/complexity, and run every requested check with
   captured exit codes. Keep this plan active because the user requested no commit.

## Decisions

- Chat quotes are checked against bounded retained group conversation history,
  with canonical sender ids resolved back to the two game players; post quotes
  are checked against the canonical game projection.
- Check-in scheduling will derive from the player's frozen game zone and existing
  lifecycle due time rather than add a scheduler or persisted local-time state.
- Lore size is bounded by the dedicated read/replace tool; callers cannot choose
  a path, and the host derives the opaque pair namespace. No database owner is
  introduced.
- Chat-line repetition validation reads bounded `Chat line used:` entries from
  the pair workspace, while verbatim group quotes are checked against bounded
  retained room messages resolved back to the two canonical players.
- Recap and check-in lifecycle notices use a game-host profile. Recap exposes
  only `read_game`, `write_recap`, and pair lore; check-in exposes pair lore plus
  send-or-skip. Ordinary manual notifications remain output-only.

## Verification

- Focused hosted-execution tests: 14 passed, exit 0. Focused assistant-engine
  tests: 130 passed, exit 0. Focused Web game tests: 82 passed, exit 0; the
  final pair-fingerprint/lifecycle/tool subset added 60 passing tests, exit 0.
- All 15 game PostgreSQL suites passed (164 tests) against one isolated local
  database, exit 0. The database was dropped afterward and its absence verified.
- The focused real-Codex recap journey passed on the final assistant candidate,
  exit 0. It used exactly `read_game` then `write_recap`, returned the saved
  server line, and exposed the bounded current-room transcript and pair lore.
- The final complete-initial-provider-input measurement passed (3 cases), exit
  0. Direct stayed 156,566 bytes (delta 0); a group with no live game stayed
  148,806 bytes (delta 0); a group with a live game moved from 148,806 to
  149,998 bytes, +1,192 bytes (+0.801043%). The capture environment does not
  include the exact GPT-6.1 Sol tokenizer, so exact baseline/candidate token
  counts and token delta are unavailable; no substitute estimate was recorded.
- Follow-up optimization proof passed: focused assistant-engine suites, 148
  tests, exit 0; focused hosted-execution guidance suite, 8 tests, exit 0. The
  focused real-Codex recap journey passed again on `gpt-6.1-sol` through local
  subscription auth with exactly `read_game` then `write_recap`; reply review
  remained Ready.
- `pnpm typecheck`: exit 0. `pnpm --dir apps/web lint`: exit 0 with existing
  warnings. `pnpm complexity:diff`: exit 0. The final Web production build and
  its 14,800-test app lane passed inside diff verification.
- `MURPH_VERIFY_SHARED_HOST=0 pnpm test:diff` was run four times. Early runs
  exposed and led to fixes for the runtime-config fixture, the ordinary-tool
  expectation and a client-bundle `node:crypto` boundary. Later runs completed
  the changed product lanes but exited 1 on two unrelated shared-host flakes:
  a Vitest worker-RPC teardown race after all 4,632 Cloudflare tests passed, and
  a random UDP test-port `EADDRINUSE` in the CLI timing suite. Exact reruns passed:
  Cloudflare verify (4,632 + 20 tests), exit 0; the CLI timing test, exit 0.
Completed: 2026-10-30
