# Board no-readings and reported VO2 persistence

Status: completed
Created: 2026-11-05

## Outcome and invariants

Distinguish readable empty board shares from syncing using an optional pending
reason. Save reported VO2 estimates through canonical measurement writes and
project them into shared and private daily numbers. Preserve the shipped state
vocabulary, share authority, private notes and manual provenance.

## Evidence and smallest correction

The board collapses missing and unusable records into pending. Measurement
MetricPoints currently have event grain, but both downstream readers require day
grain. Project only VO2 measurements at day grain. No cache version bump: any
canonical source change already fails the manifest check and rebuilds the query
cache with current code, so a new reported VO2 write projects at day grain. Only
VO2 measurements already stored in an otherwise unchanged vault stay event grain
until that vault's next write. No new persistence or dependency.
Use the catalog's 45-day VO2 freshness policy and the existing aerobic skill.

## Scope and proof

- Empty, unreadable and unusable shares; one reported value with no comparison.
- Typed/device-image reports, displayed date or local today, receipt before saved.
- The CLI measurement-add write (in-process, via vault-usecases) through query,
  grantor projection and browser replica.
- Whole query, assistant-engine and assistant-runtime suites; Web board tests;
  Web and package typechecks, generated artifact checks and parent diff review.
- The parent explicitly deferred changelog authoring and real-Codex journeys.
- Backend only; no iOS or UI changes, commits, pushes, PRs or deployments.

## Deployment

Web owns the additive board reason and stale policy. The hosted runtime owns
query projection and assistant skills. Either order remains readable; runtime
refresh republishes existing grant snapshots and browser replicas. The query
cache version is unchanged, so deploy forces no fleet-wide rebuild.

## Verification results

All final commands passed; no unrelated failures required changes.

| Command | Result |
| --- | --- |
| `pnpm exec vitest run --config packages/query/vitest.config.ts` | 80 files passed; 822 tests passed, 1 opt-in measurement skipped |
| `pnpm exec vitest run --config packages/assistant-engine/vitest.config.ts` | 307 files passed, 10 skipped; 6,016 tests passed, 775 skipped |
| `pnpm exec vitest run --config packages/assistant-runtime/vitest.config.ts` | 185 files passed, 1 skipped; 4,074 tests passed, 7 skipped |
| `pnpm exec vitest run --config apps/web/vitest.config.ts test/game-board-numbers.test.ts test/game-board-postgres.test.ts` | 2 files, 34 tests passed with `MURPH_TEST_POSTGRES_CONCURRENCY=1` and a disposable loopback test database |
| `pnpm exec vitest run --config packages/cli/vitest.config.ts test/cli-typed-agent-inputs-schema.test.ts test/cli-timing.test.ts test/incur-config-schema-preparation.test.ts` | 3 files, 27 tests passed |
| `pnpm --dir packages/query typecheck` | Passed |
| `pnpm --dir packages/assistant-engine typecheck` | Passed |
| `pnpm --dir packages/assistant-runtime typecheck` | Passed |
| `pnpm --dir apps/web typecheck` | Passed |
| `pnpm complexity:diff` | Passed, no hotspots |
| `git diff --check` | Passed |

The PostgreSQL run applied production migrations with
`pnpm --dir apps/web prisma:migrate:deploy`; the schema contract passed and the
task-created database was removed. The earlier default board run passed 21 tests
and skipped 13 PostgreSQL cases; the enabled run above supersedes it.

The new composed CLI test initially expected an envelope around the JSON receipt.
Corrected that test expectation to match the CLI's direct JSON result. The full
runtime suite then passed, including CLI write, manual metric provenance, share
record and private browser-series assertions. Other measurement grains remain
unchanged. Board tests cover no-readings, plain pending, one manual value, and
the 45-day freshness boundary. The engine suite covers skill asset validation
and the existing 81,100-character route prompt cap.

## Deployment cost and remaining limits

The query cache version stays at 35, so deploying forces no rebuild. The write
that saves a reported VO2 reading changes the source manifest, and that rebuild
runs current code. A cache version bump was tried and dropped: it would have
invalidated every member's cache on next use to re-project VO2 measurements
that, in practice, no vault holds yet.

Skill selection remains model-directed via the resident domain-owner routing.
The updated catalog hint is metadata, not a deterministic keyword loader.
Plain-text and screenshot model behavior remain unverified by explicit parent
request. Saved device notes stay private; shared source is `manual`. Existing
0–100 VO2 projection bounds and 90-day board retention remain unchanged.

Backend verification is complete. Changes remain uncommitted for parent review;
no UI, iOS, deployment, push or PR work was performed.
Updated: 2026-11-05
Completed: 2026-11-05
