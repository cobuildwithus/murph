# Typed game ideas and self area-code hint

Status: completed
Created: 2026-11-15
Updated: 2026-11-15

## Outcome and scope

Port the measured typed-words prototype into the authenticated game API. The
native bank remains available when generation fails. Add only a caller's
verified NANP area code to Home. No stored suggestions, schema change, new
dependency, production setting change, push or PR is needed in this task.

## Design and protected invariants

- Reuse game auth, pure command text normalization, moderation and the atomic
  auth limiter. Suggestions add stricter rules without changing manual entry.
- Copy the iOS bank's calibrated rule text. One predicate per cleaned idea;
  shared rules stay in Decisions input. Never return unchecked candidates.
- Allow 30 requests per member per 600 seconds across all steps. Bound at most
  two writes and two checks under one eight-second deadline with no SDK retries.
- Send only the allowlisted request context to OpenAI. Typed words can contain
  anything a member writes. Do not attach identity or private labels.
- Derive the optional self hint from the existing identity owner, never an
  opponent lookup. Old clients ignore it and missing hints keep near defaults.

## Product UX plan

Entry: typed words in More ideas, with bank ideas still usable while waiting.
Journeys: valid task/prize/dare, insufficient accepted ideas and one retry,
provider failure/timeout/malformed output, kill switch, denied auth/validation/
budget, and verified/unverified/non-NANP/missing self phones.
Proof: route and SDK-fetch scenarios plus canonical manual moderation tests.
The app's rendering and fallback are owned by the later native PR.

## Work and verification

1. Implement allowlisted input, brief/check/cleanup, shared deadline and route.
2. Add self hint and contract; update privacy owners and the optional live eval.
3. Run focused tests, requested test:diff/typecheck, Web lint, complexity diff;
   inspect the candidate and commit locally. Parent owns CI and final ReviewGPT
   on the pushed head because this introduces a provider/public API boundary.

## Evidence

Implementation and candidate review complete. Server-boundary UX: Ready.
The route never saves suggestions, never attaches identity to OpenAI, and never
returns an unchecked provider result. Review also covered malformed-JSON log
redaction, skipped-text retention across retry and unchanged manual acceptance.
The caller-only Home hint is proven through the real identity store. Native
rendering/fallback and live model quality remain outside the available evidence.

Exact commands and results:

- `pnpm --dir apps/web test -- test/game-ideas.test.ts test/game-ideas-route.test.ts test/game-area-code.test.ts test/game-command.test.ts test/game-moderation.test.ts`: exit 0, initial 201 tests, including automatic Prisma generation.
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/game-ideas.test.ts apps/web/test/game-ideas-route.test.ts apps/web/test/game-area-code.test.ts apps/web/test/game-command.test.ts apps/web/test/game-moderation.test.ts apps/web/test/game-profile-vault-route.test.ts`: exit 0, final 246 tests and two existing skips.
- `pnpm --dir apps/web typecheck:prepared`: exit 0 on the final source.
- `pnpm --dir apps/web lint`: exit 0 on the final source; existing unrelated warnings, none in the added idea or area-code files.
- `pnpm complexity:diff`: exit 0 on the final source; 16 changed source files, no hotspots above 20, new maximum 15.
- `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/murph_test_game_ideas MURPH_PRISMA_SKIP_ENV_FILES=1 pnpm --dir apps/web prisma:migrate:deploy`: exit 0 in a newly created, isolated local database.
- `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/murph_test_game_ideas MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/game-service-postgres.test.ts -t "projects only the caller's verified area code in Home" --maxWorkers=1`: exit 0, one selected test passed. The task-created database was then removed without force.
- `pnpm docs:drift`: exit 0.
- `pnpm docs:gardening`: exit 0, no issues.
- `pnpm --dir apps/web game:ideas-eval 173 1`: exit 2 as expected with no `OPENAI_API_KEY` in this session. No provider call or live quality claim; no secret files were loaded.
- `pnpm test:diff apps/web`: first run exit 1, with 14,665 passing tests and 31 failures in the existing Home profile-adoption fixture, which lacked the newly read identity table. Added its no-identity stub.
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/game-profile-vault-route.test.ts`: exit 0 after the fixture correction, 40 tests passed and two existing skips.
- `pnpm test:diff apps/web`: final run exit 0 (747 seconds). Typecheck, 869 test files / 14,697 tests, lint, development smoke and production Next.js build passed; 171 files / 2,674 opt-in tests were skipped. The focused PostgreSQL proof above ran separately.

Bank parity was checked against the sibling iOS build: all requested rule
strings, regexes, questions and limits match exactly. Diff whitespace, private
identifier and authored em-dash scans passed. Commands were captured directly
with subprocess exit codes, without a pipeline that could mask a failure.

This is a dedicated Responses/Decisions writer, not an assistant-runtime prompt
or tool change. The standalone eval is its live proof path. No public changelog
entry in this preparatory backend slice: the subsequent native More ideas UI
owns the member-visible release note. No migration or deployment coordination
is required; older apps ignore the hint and newer apps retain bank ideas against
an older server. Parent owns the pushed-head CI and eligible ReviewGPT round.
Completed: 2026-11-15
