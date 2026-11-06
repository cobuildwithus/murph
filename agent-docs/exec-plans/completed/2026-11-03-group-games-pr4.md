# Group games PR 4: capability, privacy projections and daily notifications

Status: completed
Created: 2026-11-03
Updated: 2026-11-03

## Goal

- Ship the reduced multiplayer API behind an explicit request capability while preserving legacy pair JSON and production group admission-off behavior.

## Success criteria

- Legacy clients cannot discover or mutate groups; capable clients receive the final contract and addenda.
- Viewer masks apply before decryption/signing, and collection filters precede limits.
- One notifier owns two recipient-local daily claims, preserves pair copy and suppresses stale delivery.
- Focused HTTP, rule, projection, privacy, notifier and PostgreSQL proof passes, with measured maximum-cardinality reads.

## Scope

- In scope: contract, HTTP capability/routes, projections, history/wallet, invite preview, notifier, verification and owner docs.
- Out of scope: exact-group chat, composer, group recap generation, hosted tools, rollout enablement, push and PR creation.

## Constraints

- Extend existing owners; one serializer path with a capability flag, canonical GameEvent claims, no new persisted state.
- Keep existing legal/profile authorization; capability never grants authority. Use transient recipients only.
- Local scoped conventional commit with the requested coauthor trailer; parent reviews before any publication.

## Risks and mitigations

1. Pair wire drift: preserve omitted fields and pending invitee; compare serialized fixtures.
2. Privacy leakage: mask before decrypt/sign and revalidate media and push authority.
3. Notification races: claim under existing game lock, preserve legacy claims, send after commit without releasing claims.

## Tasks

1. Extend contract and thread capability through every HTTP game boundary.
2. Extend existing projection/hydration owners for participation, results, parties, preview and history.
3. Extend daily notification claims and stale delivery revalidation; exclude groups from missed-day production.
4. Run focused and maximum-cardinality proof on an isolated local database; remove it afterward.
5. Review diff, update owner docs and evidence, run typecheck/lint/complexity/docs checks, commit locally.

## Decisions

- PR 3 already owns group lifecycle, terms parser, report targeting and privacy predicates; PR 4 exposes and verifies those paths.
- Product journeys: legacy pair starter/pending invitee; capable group starter and late joiner; authenticated versus public preview; blocked/reported viewer; left/deleted participant; shared prize participant; first/final notification, concurrent posts and delayed delivery.
- No changelog until rollout: this is a dark backend protocol extension; group admission remains disabled in production.

## Verification

- Focused game suites, isolated PostgreSQL suites, Web typecheck and lint, `pnpm complexity:diff`, docs checks.
- Measure datastore calls, decrypt/sign work, concurrency and JSON bytes for ten players, 365 days and existing collection limits.
- Product walkthrough: Ready for parent review. Composed tests replay legacy pair/pending-invitee, group starter/late joiner, edit/leave/retry, public/authenticated invite, newly registered addressee, block/report/departure/deletion, shared prize and stale notification journeys.
- Parent review, remote CI and final external review remain with the parent: this task explicitly forbids pushing or opening a PR.

## Implementation and spec mapping

- Final spec §2: `contract.ts` contains every reduced contract addition, including group create, sparse task overrides, participation, progress, permissions, results, ticket parties, group history and open previews. `command.ts` now uses that single public command type; the obsolete parallel internal union is deleted. Composer is intentionally PR 5.
- Capability boundary: `http/capability.ts`, `http/command-route.ts`, the Home/history/detail/preview/dev/media routes and `service.ts`. Legacy predicates precede collection limits; immutable group targets are rejected before command preparation. Capability never replaces authentication, current legal terms, profile or game authority.
- Final spec §3 privacy: `service.ts`, `views.ts` and `http/media-routes.ts` mask before entry decryption and signing, keep payload-free submitted status, preserve canonical scoring, and exclude hidden posts from latest posters/history previews. Group report targeting reuses PR 3 and has composed proof.
- Final spec §3 notifications: `post-notification.ts` owns first/completion claims, legacy receipts, real recipient 03:00 days, candidate inclusion, incomplete artifacts, coincident milestones and after-commit stale suppression. `service.ts` passes the inserted candidate. Pair copy and missed-day behavior remain; both `missed-check-in.ts` and the sweep exclude groups.
- Addendum 1: new `games/[id]/leave/route.ts` and `games/[id]/terms/route.ts` dispatch canonical commands; edit requires current legal terms through `http/auth.ts`.
- Addenda 2 and 5: public invite route optionally authenticates; `service.ts` supplies authenticated-only `alreadyIn`, own profile names/photo, addressed `yourTask` (including registration after invitation), and `dayOne`. Final-day artifact metadata preserves the existing conditional offline-grace deadline.
- Addendum 6: `views.ts` supplies `history.groups[].task` and `.prize`, with roster/results per round.
- Addendum 7: existing group change-request rejection remains; `rules.ts` also rejects group Start now.
- Addendum 8: `readHome` derives `canStartGroups` per request from switch and allowlist. Server create and join still reject with admission off.

## Changes by file

All game implementation paths below are under `apps/web/src/lib/game/`.

| File | Change |
| --- | --- |
| `contract.ts` | Reduced public contract and exact addenda field names. |
| `command.ts` | One command type and required private invitee first name. |
| `service.ts` | Capability filtering, shared hydration, group history/preview, media masks, Home narrowing and notifier integration. |
| `views.ts` | One capability-aware serializer for roster, participation, progress, permissions, standings, parties and history. |
| `rules.ts` | Reject group Start now. |
| `post-notification.ts` | Unified two-slot claims and stale delivery checks. |
| `missed-check-in.ts` | Pair-only producer. |
| `http/capability.ts` | Exact protocol header. |
| `http/command-route.ts` | Capability propagation and common response transport. |
| `http/auth.ts` | Current legal terms for editing terms. |
| `http/media-routes.ts` | Capability-aware authorization and signed group history previews. |
| `http/response.ts` | Stream capable JSON without changing its bytes or schema. |

Under `apps/web/app/api/game/v1/`:

| Route file | Change |
| --- | --- |
| `home/route.ts` | Capability, group Home and response transport. |
| `history/route.ts` | Capability, group history signing and response transport. |
| `games/[id]/route.ts` | Capability-aware detail and response transport. |
| `games/[id]/leave/route.ts` | New POST command route. |
| `games/[id]/terms/route.ts` | New PUT command route. |
| `invites/[token]/route.ts` | Public capability plus optional authenticated preview. |
| `media/[...key]/route.ts` | Capability-aware media authorization. |
| `dev/games/[id]/advance-day/route.ts` | Capability guard and response transport. |
| `dev/games/[id]/settle/route.ts` | Capability guard and response transport. |
| `dev/games/[id]/start-now/route.ts` | Capability guard and response transport. |

Under `apps/web/test/`:

| File | Proof |
| --- | --- |
| `game-groups-postgres.test.ts` | HTTP, admission switch, previews, privacy, concurrent daily slots, maximum load; explicit capability in existing group journeys. |
| `game-collections.test.ts` | Capable participation/progress/frozen standings/parties and full Home baseline. |
| `game-post-notification.test.ts` | Coinciding slots, incomplete posts, legacy claims, real day/DST, blocks, stale delivery and unchanged pair copy. |
| `game-response.test.ts` | Multi-megabyte streaming preserves exact JSON/Unicode; legacy headers/bytes. |
| `game-routes.test.ts` | Existing boundary now passes explicit capability. |
| `game-history-views.test.ts` | Pair history assertions narrow the public pair/group union. |
| `game-media.test.ts` | Media authorization receives the capability flag. |
| `game-service-postgres.test.ts` | Existing pair push proof expects two coincident receipts; real-clock delivery remains aligned with the test clock. |
| `game-account-deletion-postgres.test.ts` | Group deletion reads explicitly declare capability. |
| `game-missed-check-in.test.ts` | Groups never produce missed-day work; pair behavior remains. |

Documentation: `ARCHITECTURE.md` and `agent-docs/product-specs/weekly-game.md`
now own the capability, projection, transport and notifier behavior;
`agent-docs/references/testing-ci-map.md` routes the new proof;
`agent-docs/index.md` links this completed evidence. This plan records scope,
decisions, proof, measurements and the parent handoff.

## Maximum-cardinality measurements

Real isolated PostgreSQL, ten admitted players, 365 days, fifty Home games,
two hundred wallet tickets, and fifty history audiences with fifty rounds each.
The detail/Home fixture stores 182,500 photo artifacts with 140-character
captions. History stores six previews per round. Numbers include service
projection plus optional signing, excluding HTTP authentication. Decrypt counts
are non-null fields submitted to the crypto owner. The fixture uses the local
test codec and synthetic signatures, so timings are local observations, not
production KMS/provider latency predictions. The existing pair real-crypto
history suite separately proves request-scoped root reuse.

| Read | Datastore operations / queries | Peak queries | Decrypted fields | Signatures / peak signing | JSON bytes | Local ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Detail | 8 / 8 | 5 | 3,661 | 0 / 0 | 1,611,482 | 65 |
| Home, already posted | 14 / 14 | 5 | 561 | 0 / 0 | 1,008,864 | 2,723 |
| Home, locked previews signed | 15 / 15 | 5 | 61 | 450 / 6 | 962,414 | 4,681 |
| History, latest previews signed | 58 / 58 | 4 | 2,511 | 300 / 6 | 12,783,714 | 5,282 |

The measured full-calendar Home baseline was 80,776,964 bytes. Group Home now
projects/decrypts the current live day only, retaining full rule metadata and
full detail. History at existing limits is still 12.78 MB. Capable responses
therefore stream the unchanged JSON in 64 KiB chunks; legacy responses retain
the existing helper. No schema, pagination, cache or persistent count was added.
The host documents a 4.5 MB buffered limit and streaming escape:
[Vercel limits](https://vercel.com/docs/functions/limitations) and
[streaming guidance](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions).
No hosted deployment was performed; the transport proof is local.

## Verification evidence

- `pnpm install --frozen-lockfile`: passed; no manifest/lockfile changes.
- `DATABASE_URL=<isolated-loopback-db> pnpm --dir apps/web exec prisma migrate deploy`: passed on a fresh database.
- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/game-*.test.ts`: 582 passed; database cases intentionally skipped in this lane.
- `DATABASE_URL=<isolated-loopback-db> MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage --maxWorkers=1 apps/web/test/game-*-postgres.test.ts`: 244 passed in 17 files on the clean final run.
- Byte-level compatibility experiment: ran both existing view/history suites against the PR 3 `views.ts` from the branch base and compared every serialized result to the new legacy serializer. All 39 cases passed, including pending invitees, tickets and departures. The temporary baseline source and wrappers were removed.
- `pnpm --dir apps/web typecheck:prepared`: passed.
- `pnpm --dir apps/web lint`: passed with existing repository warnings; task-owned unused-variable warnings removed.
- `pnpm complexity:diff`: passed; zero changed-source hotspots above 20.
- `pnpm docs:drift`: passed. `pnpm docs:gardening`: passed, zero issues.
- `git diff --check` and authored-identifier scan: passed.
- Initial failures were corrected: explicit capability in group test callers, stale mock arity, final fixture metadata and cleanup. Large-fixture cascade cleanup timed out and left test rows; set-based entry cleanup fixed it, and the final aggregate passed on a recreated database. No test timeout was relaxed.

## Deferred and handoff

- PR 5: exact-group chat, composer, group recap generation and hosted tools,
  as required by the brief. Chat-bound group creation still rejects.
- Production admission remains off by default. No production mutation,
  deployment, push or PR creation was performed.
- No public changelog: no rollout or member-visible release in this dark backend
  task. Parent owns publication, exact-head CI and external final review.
- The isolated database is removed after the final verification. No test data,
  temporary baseline source or numeric load output is included in the commit.

Completed: 2026-11-03
