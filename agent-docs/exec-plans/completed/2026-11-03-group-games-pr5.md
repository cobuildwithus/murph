# Exact audience game chat, composer handoff, and group recaps

Status: completed
Created: 2026-11-03
Updated: 2026-11-03

## Goal and result

Implement PR 5 of the dark 2–10 player backend in the assigned checkout.
Reuse the existing membership, command, lifecycle, delivery, recap and tool owners.
No schema, queue, persisted delivery-mode state or group bootstrap producer was
added. Production group admission remains off. Parent review is the next step;
no push, PR, deployment or production mutation is authorized.

## Completed work and authoritative spec mapping

Section 2: `CreateGameView.composer` is a response-only explicit handoff.
Section 3: exact-room discovery runs with transient handles before transactions;
commit revalidates the prepared room, local roster, route, identity and sharing
restrictions. Existing rooms use the existing invite receipt. Composer replay
repeats the handoff, including concurrent create convergence, without bootstrap.
Ordinary inbound preparation and admission associate the accepted invite URL by
rotating keyed equality before game-backed runtime access. Association does not
join. A canonical join checks the sender, room, profile and published legal terms.
Bearer-only invitations cannot associate a shared room.

Section 3 egress: complete current provider membership, bound room, actual target,
local roster, departures, blocks and revoked consent are checked at the existing
Linq engagement boundary. Unsafe shared reads and generated material are withheld.
There is no silent retarget. Shared recaps are withheld after any group report,
so a single story cannot violate differing viewers' masks. Labels and private lore
are excluded, duplicate first names get stable suffixes, and each eligible person
needs one kind superlative. Group recap validation rejects missed-person shaming.

Section 4 PR 5: the signed query capability preserves old strict pair consumers.
Group tools use canonical starter edits before Day 1, no negotiations or Start
now, and no person-to-person nudging. Pair policy, bootstrap and #4458 stay intact.

## File map

All paths below are repository-relative. Under `apps/web/src/lib/game/`:

| File | Result |
| --- | --- |
| `chat-membership.ts` | Bounded exact audiences, normalized provider proof, rotating identities, names, room preparation and inbound association. |
| `chat-access.ts` | Exact original audience funding; rejects extra/missing people and blocks; pair funding stays exactly two. |
| `chat-bootstrap.ts` | Group policy cannot produce legacy bootstrap work. |
| `chat-delivery.ts` | Fresh audience and actual target validation for game lifecycle sends. |
| `chat-delivery-authority.ts` | Transactional original-audience, departure, consent, block and recap-report checks. |
| `chat-lifecycle.ts` | Group invite/kickoff/recap dispatch through existing receipts; no group missed-day notices or bootstrap. |
| `chat-progress.ts` | Late-join day bounds and neutral group missing-post status. |
| `chat-photo.ts` | Propagates multiplayer capability through exact room validation. |
| `chat-tool.ts` | Signed accepted-input authority, legacy capability fence and group recap boundary; inbound admission alone owns composer association. |
| `contract.ts` | Explicit optional create composer response. |
| `service.ts` | Group create preparation/binding/handoff, canonical chat create/join/edit, names, shared projections and recap privacy. |
| `recap.ts` | 2–10 unique eligible superlatives, hidden quote rejection and group kindness rules. |
| `recap-regeneration.ts` | Bounded ten-person roster and symmetric block checks through existing regeneration receipt. |

Other runtime files:

| File | Result |
| --- | --- |
| `apps/web/src/lib/hosted-onboarding/webhook-service.ts` | Prepares invite/audience proof outside inbound planning transactions. |
| `apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts` | Associates ordinary verified inbound rooms before runtime access evaluation. |
| `apps/web/src/lib/hosted-groups/group-tool.ts` | Propagates capability to the game owner. |
| `apps/web/app/api/internal/hosted-execution/groups/tool/route.ts` | Reads the signed capability query. |
| `apps/web/app/api/internal/hosted-runtime/linq-egress/engagement/route.ts` | Supplies the resolved actual destination to final game audience validation. |
| `apps/cloudflare/src/runtime-platform/group-tool-port.ts` | Adds `gameMultiplayer=1` to the signed existing URL. |
| `packages/hosted-execution/src/game-tools.ts` | Consumer schema accepts original invitee/task references, default tasks, settlement eligibility, group ticket parties, recap superlatives and edit_terms. |
| `packages/hosted-execution/src/game-chat-notifications.ts` | Group-specific consent/kickoff and kind recap instructions; no private lore. |
| `packages/hosted-execution/src/game-bootstrap-control.ts` | Documents the retained pair-only compatibility control. |
| `packages/assistant-engine/src/assistant-codex/dynamic-tools/games.ts` | Capable schemas, member-keyed edits, group guidance and multiple-game selection. |
| `packages/assistant-engine/skills/group-challenge/SKILL.md` | Defers managed group games to canonical tools and their group policy. |

Proof files: Web `game-chat-membership.test.ts` covers exact/extra/missing/duplicate
and incomplete rosters and duplicate names; `game-chat-tool.test.ts` and
`game-chat-delivery.test.ts` preserve legacy assertions at the capability/bounds
seams; `game-groups-postgres.test.ts` proves room discovery, composer replay,
rotation, identity ambiguity, multiple games, refusal, canonical joins and recap
privacy; `game-recap.test.ts` proves ten superlatives, omissions, shaming and hidden
quote/media rejection; `hosted-onboarding-linq-egress-engagement.test.ts` exercises
the real audience reader and egress route, stubbing external ports only.
Hosted-execution `game-tools-compatibility.test.ts` compares the exact released
base parser in both skew directions; `game-chat-notifications.test.ts` protects
group consent, reminder and lore rules. Cloudflare `group-tool-port.test.ts` proves direct/proxy capability signaling with unchanged request JSON.
Assistant-engine `assistant-game-tools.test.ts`
protects two-person group policy, full-roster edits and selection;
`assistant-codex-real-e2e.test.ts` adds the production-builder live acceptance journey.

Durable owners updated: `ARCHITECTURE.md`, `agent-docs/SECURITY.md`,
`agent-docs/product-specs/weekly-game.md`, `agent-docs/references/testing-ci-map.md`,
`agent-docs/index.md`, and both touched package READMEs. No public changelog:
this is dark backend/tool staging and ships no newly admitted member experience.
`recap-message.ts` already formats a game ID and generic link independently of
roster cardinality; it needed no change. Legacy lifecycle receipt identity and
notifier slots remain with their existing owners.

## Verification

- `pnpm install --frozen-lockfile`: passed; dependencies were initially absent.
- Isolated loopback database `murph_test_group_games_pr5`; Prisma `migrate deploy`
  passed through the current migration. An early cleanup failure left a synthetic
  phone; after fixing cleanup, recreated the database and reran successfully.
- `MURPH_TEST_POSTGRES_CONCURRENCY=1 DATABASE_URL=<isolated-loopback-url> pnpm exec
  vitest run --config apps/web/vitest.config.ts --no-coverage` with
  `game-groups-postgres`, `game-chat-access-postgres`, `game-chat-setup-postgres`,
  `game-chat-progress-postgres`, `game-service-postgres`,
  `game-chat-bootstrap-recovery-postgres`, `game-late-recap` selectors:
  6 matching suites, 129 tests passed with `--maxWorkers=1 --no-file-parallelism`.
  Final group chat/composer selection: 5 passed, including two-person group
  rematches, explicit terms refusal, canonical sparse task edits and concurrent replay.
  A concurrent verification run timed out the pre-existing load fixture; the
  serial rerun passed without changing its limit.
- Web focused membership/tool/delivery/authority/lifecycle/bootstrap/recap/progress/
  photo suites plus real egress: 356 passed across 10 suites.
- Real engagement route suite after strengthening provider proof: 140 passed.
- Linq thread-route/webhook/graph-boundary suites: 170 passed.
- `MURPH_VERIFY_GAME_GROUP_SKEW=1 pnpm --dir packages/hosted-execution exec vitest
  run --config vitest.config.ts --no-coverage test/game-tools-compatibility.test.ts
  test/game-chat-notifications.test.ts`: 39 passed, 2 unrelated historical lanes
  skipped. PR 5 historical parser proof ran; shallow routine CI skips that opt-in.
- Assistant-engine assistant-game-tools/game-chat-bootstrap: 43 passed.
- Cloudflare group-tool-port: 11 passed, including signed direct/proxy capability
  transport with unchanged old-Web request JSON.
- `pnpm --dir apps/web typecheck` prepared prerequisites, then repeated
  `typecheck:prepared`: passed. `pnpm --dir packages/hosted-execution typecheck`,
  `pnpm --dir packages/assistant-engine typecheck`, and
  `pnpm --dir apps/cloudflare typecheck`: passed.
- `pnpm --dir apps/web lint`: passed with existing warnings; touched package and
  runner files also passed the installed oxlint with zero warnings/errors.
- `pnpm complexity:diff`: passed; no added complexity debt.
- `pnpm docs:drift`, `pnpm docs:gardening`: passed, zero gardening issues.
- `pnpm --dir apps/cloudflare runner:bundle`: passed production assembly and
  local absolute caps: entry 77,854 bytes; static startup 1,998,406 bytes across
  22 chunks (24 allowed); total 12,222,716 bytes. Exact-base Linux growth CI
  remains a parent push/merge gate; local macOS totals are diagnostic.
- `pnpm test:assistant:live -- --test "group game addressed acceptance with duplicate first names"`:
  passed with gpt-6.1-sol, local subscription, on an authorized alternate profile.
  Default profile hit usage limit and the first alternate was unauthorized, both
  before provider action. Successful run: one read, one canonical approve for the
  correct disambiguated person; no extra effects. Reply review **Ready**: clear,
  accurate, no invented consent, internal IDs, shame or nudge. The run reported
  88,338 input tokens, 57,984 cached input tokens and 177 output tokens. No model
  or account secrets were read or copied.

Initial failed checks exposed pair funding cardinality, old-reader defaulting,
legacy mock expectations and type-boundary issues; each was corrected. The final
focused checks replace those failed attempts. Commands accidentally run with an
app cwd found no tests; corrected root config invocations ran actual suites.

## Proposed PR body for the parent

Exact addressed groups can now use an existing matching Murph chat, or receive an
explicit Messages composer handoff. Verified inbound invite messages associate
composer-created rooms without accepting anyone automatically. Group tools and
recaps reuse the existing owners, preserve pair behavior, and reject unsafe shared
reads and delivery after roster/privacy changes.

Deploy **Web first, then the Cloudflare runner bundle**. The new bundle opts in
through signed `gameMultiplayer=1`. Old warm bundles stay pair-only against new
Web; new bundles accept old Web's pair responses. Keep `MURPH_GAME_GROUPS_ENABLED`
off in production. A separate Cloudflare runner deploy is required after merge.

Local PostgreSQL, provider-boundary, schema-skew, assistant, typecheck, lint,
complexity, docs and runner assembly checks pass. Parent review, pushed exact-head
CI, native Linux exact-base bundle growth and required ReviewGPT remain before
merge. No production deployment or physical Messages composer send was performed.

## Completion bookkeeping

Final diff/privacy review and concurrent-create replay proof passed. The isolated
database was dropped and a catalog check returned zero matching databases.
Numeric-only load output was removed. No additional Frog entry was warranted;
verification retries addressed task-local regressions and resource contention.
Archive this plan with the scoped local commit. Parent review, pushed exact-head
CI and ReviewGPT remain outside this no-push handoff. No implementation scope is
deferred. Production admission, deployment and physical Messages testing remain
separate release actions.
Completed: 2026-11-03
