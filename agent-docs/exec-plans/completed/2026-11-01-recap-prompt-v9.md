# Recap prompt v9 and optional score line

Status: completed
Created: 2026-11-01
Updated: 2026-11-01

## Goal

Apply the supplied recap prompt clauses verbatim and allow recaps without
`scoreLine` across the model tool, Web validation, storage and replay.

## Scope and constraints

Use the existing recap schema and sealed game storage. Preserve every supplied
legacy score line and all validation when present. No database migration,
new abstraction, iOS renderer change, production access, deployment, dispatch,
commit, push or PR. The parent owns integration.

## Product UX

Outcome: stories open on tasks and prize, use stats only for a numerical joke,
and exclude bookkeeping, app feedback and invented events.
Reaches: both players, winning and tied games, fresh saves and old recap replays.
Proof: exact prompt assertions, optional/legacy tool contracts, Web validation,
local PostgreSQL save/read/replay and focused synthetic real-Codex journeys.

## Tasks

1. Apply the four prompt replacements and make the existing score line optional.
2. Inspect every `git grep scoreLine` hit and follow the shared schema into
   sealed storage, API projections and response parsing.
3. Run requested focused suites, normal hydration, typecheck and local review.
4. Record compatibility, evidence and any unavailable completion gates; hand off
   uncommitted changes.

## Decisions

- The parser already delegates to the shared Zod schema; retain `scoreLine` in
  its recognized root keys to preserve old calls.
- Guard validation on undefined, not truthiness, so empty legacy strings still
  receive existing naming and result checks.
- Keep legacy fixtures alongside absent-field regression coverage.
- Completed historical plans and the unrelated challenge-standings local
  variable stay unchanged.
- The game remains dark/allowlisted under its product contract; no public
  changelog is added for this unreleased game tuning.
- Web must deploy first. No schema migration or two-PR split is needed.
  Web composes the notification prompt; the old runtime tool still requires
  the line during the Web-first window. Retain compatible Web/runtime readers
  once omitted-line recaps exist.
- ReviewGPT and exact-head CI belong to the parent's future pushed PR; this
  task explicitly prohibits committing, pushing and opening that PR.

## Verification

- Frozen dependency install: passed.
- Hosted-execution notifications and tools: 32 passed, one existing skipped case.
- Assistant-engine game tools: 26 passed.
- Web recap, chat tool and group route: 59 passed.
- Local late-recap PostgreSQL: eight passed, including absent and legacy
  save/read/replay equality.
- Root typecheck: passed again after all TypeScript edits.
- Complexity diff: passed; no hotspots above 20, validator maximum 11 to 12.
- Initial real Codex win and tie journeys passed with local subscription auth
  and `gpt-6.1-sol`. Copy review found the synthetic server omitted the existing
  banned-term correction; added that correction without changing the prompt.
  Final reruns passed: win corrected one rejected draft before one seal; tie
  sealed on its first write. Both queued exactly one saved chat line, omitted
  scoreLine and app feedback, and opened on tasks/prize. UX verdict: Ready.
- Final diff, four-line-only prompt replacement and privacy review: passed.
- Docs drift initially required the index update, then a plan at 15 files;
  this plan records the bounded supplied patch and its evidence.


## Verification command results

All commands ran locally. The database URL below is synthetic and loopback-only.

| Command | Exit |
| --- | --- |
| `pnpm install --frozen-lockfile --prefer-offline` | 0 |
| `pnpm --dir packages/hosted-execution test test/game-chat-notifications.test.ts test/game-tools-compatibility.test.ts` | 0 |
| `pnpm --dir packages/assistant-engine test test/assistant-game-tools.test.ts` | 0 |
| `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/game-recap.test.ts apps/web/test/game-chat-tool.test.ts apps/web/test/hosted-group-tool-route.test.ts` | 0 |
| `createdb -h 127.0.0.1 -p 5432 -U postgres murph_test_recap_prompt_v9` | 0 |
| `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/murph_test_recap_prompt_v9 pnpm --dir apps/web prisma:migrate:deploy` | 0 |
| `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/murph_test_recap_prompt_v9 MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/game-late-recap-postgres.test.ts` | 0 |
| `pnpm typecheck` | 0 |
| `pnpm test:assistant:live -- --test 'game recap notification writes one sealed story and queues its saved chat line exactly; weekends off=false'` | 0 |
| `pnpm test:assistant:live -- --test 'game recap notification writes one sealed story and queues its saved chat line exactly; weekends off=true'` | 0 |
| `pnpm complexity:diff` | 0 |
| `pnpm docs:drift` | 0 |
| `git diff --check` | 0 |

Earlier attempts: the hosted suite exited 1 because the new request fixture
omitted required `priorChatLines`; corrected the fixture and reran successfully.
The live selector without the weekend suffix exited 2 because it matched two
journeys; each exact selection passed. Docs drift exited 1 for missing index
coverage, then 1 for the plan threshold; both requirements are now satisfied.

## Reader inventory

- `game-tools.ts`: optional shared Zod property; request and response shapes
  inherit it. The public type is inferred from the same schema.
- Dynamic `games.ts`: remove only the required-list entry; the existing parser
  uses the shared schema and retains the legacy recognized key.
- Web `contract.ts` and `recap.ts`: optional projected type and conditional
  validation of every legacy score-line rule.
- Web `service.ts` seal/replay and GameView readers, shared runtime parsers and
  Cloudflare group-tool port: already delegate to the schema; no duplicate
  field or separate stored shape to edit.
- Notification prompt and its test: four verbatim replacements, pinned clauses,
  and no remaining scoreLine instruction.
- Hosted compatibility tests: exercise both request and response shapes.
- Assistant game-tool and real-Codex tests: optional parser coverage and new
  writer omission; synthetic validation handles optional legacy values.
- Web recap, chat-tool, group-route and late-recap PostgreSQL tests: absent-field
  coverage plus legacy validation and exact persistence/replay equality.
- Web game-service PostgreSQL fixtures: retained to exercise legacy recaps.
- Weekly-game spec: updated current contract; historical completed recap-host
  plan remains immutable.
- Operator-config response-card scoreLine: unrelated local challenge-standings
  text variable, unchanged.

## Handoff

No production access, deploys, dispatches, commits, pushes or PRs. Parent-owned
ReviewGPT and exact-head CI remain for integration. No new awaited database or
network operations, schema migration, dependency or state owner was introduced.
Completed: 2026-11-01
