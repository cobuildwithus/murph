# Group games PR 4 parent review and publication

Status: active
Created: 2026-11-03
Updated: 2026-11-03

## Outcome and protected invariants

Preserve each group Home card's own full-calendar film strip during play and
settlement, with peers only on the current live day. Bound group history to
twenty groups and twenty-five recent games per group, preserving pair limits
and record semantics. Remove streaming and use ordinary JSON responses.
Keep the accepted capability, privacy and notifier implementation, legacy pair
bytes, detail behavior, admission-off default and no schema change.

## Owners and architecture

The existing service controls collection selection and decryption; views owns
projection. Delete the response transport helper and its test. No pagination,
windows, state or dependencies. Measure before considering history field cuts.
The earlier completed plan remains historical evidence; live owner docs will
reflect these parent corrections.

## Work

1. Correct Home projection/hydration and add live/settled film-strip proof.
2. Apply group-specific history limits before hydration; measure ordinary JSON.
3. Rerun game unit and PostgreSQL suites, pair byte parity, typecheck, lint,
   complexity and docs checks; remove the isolated test database.
4. Review and commit with the requested coauthor trailer. Push, create draft
   PR with complete evidence, mark Ready, start final ReviewGPT on the pinned
   vonneumann lane concurrently with CI.
5. Validate review timing/model/head; triage and fix accepted findings, rerun
   required rounds, then confirm required CI and mergeability. No merge/deploy.

## Product journeys

Live group film strip: every own day remains; only today's peers appear.
Settled group result: own photos and frozen result stay. Legacy pair Home,
history, pending invitee and ticket bytes stay unchanged. Group history keeps
the twenty most recent audiences and twenty-five rounds, with record computed
from displayed rounds just like pairs. Mixed pair/group collections do not
consume each other's quotas.

## Changelog

Not applicable: dark backend extension, production group admission remains off,
and old clients retain byte-identical pair responses.

## Evidence and review

Implementation is ready for the final external review. Parent-requested fixes
preserve own Home entries on every calendar day and limit peer projections to
the current live day. Group history selects twenty groups and twenty-five
recent rounds independently of pairs, before hydration; records count returned
rounds. Deleted `http/response.ts`, its test and every `gameJsonOk` use. No
history fields were removed: ordinary JSON measures below the 3 MB target.

Local verification:

- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/game-*.test.ts`: 581 passed; database cases intentionally skipped.
- `DATABASE_URL=<isolated-loopback-db> MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage --maxWorkers=1 apps/web/test/game-*-postgres.test.ts`: 244 passed in 17 suites.
- Pair byte parity against the PR 3 serializer: 39 cases passed; temporary baseline files removed.
- `pnpm --dir apps/web typecheck:prepared`, `pnpm --dir apps/web lint`, `pnpm complexity:diff`, `pnpm docs:drift`, `pnpm docs:gardening`: passed. Lint retains existing warnings; complexity has no changed-source function above 20.
- First PostgreSQL run exposed untyped CASE parameters in the new limit query; explicit integer casts fixed the proven `bigint <= text` failure. The corrected aggregate passed.

Measured ordinary JSON at ten players, 365 days, fifty Home cards and two
hundred tickets; group history returns twenty groups by twenty-five rounds
from an over-limit fixture. Pair history remains independently present.
Bulk crypto/signing are synthetic, PostgreSQL is real; counts exclude HTTP
authentication and timings are local observations only.

| Read | DB calls | Decrypt fields | Signatures | JSON bytes |
| --- | ---: | ---: | ---: | ---: |
| Home, posted | 14 | 18,761 | 0 | 10,116,074 |
| Home, locked previews | 15 | 18,261 | 450 | 10,069,624 |
| Group history plus one pair | 28 | 512 | 120 | 2,563,961 |

Peak query concurrency is at most five; signature concurrency is six. Home
retains the accepted pair-style full-calendar scaling. Detail remains unchanged
at about 1.61 MB. The live/settled serializer proof also compares group Home's
size with a full-calendar pair card. No pagination or window protocol was added.

ReviewGPT (pinned vonneumann), exact-head CI and final publication evidence are
pending. The isolated database was dropped after the final 244-test clean aggregate run. A repeat bulk fixture first exceeded its 60-second test budget on a reused database; refreshing planner statistics after bulk seeding made the clean aggregate pass without relaxing its timeout. No production query or schema optimization was added.

