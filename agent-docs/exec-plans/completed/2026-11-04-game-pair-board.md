# Pair health board and scoped sharing

Status: completed
Created: 2026-11-04
Updated: 2026-11-04

## Goal and scope

Implement wire contract sections 1 and 2: authenticated pair board GET and
scoped sharing PUT. Reuse HostedGroup membership, exact HostedVaultShare grant
generations, encrypted retained snapshots, the grant writer and its maintenance
signal. No new storage, runtime changes, private numbers endpoint, push, PR,
deploy or production access. Work and scoped commits stay on this branch.

## Owners, evidence and invariant

The group chat reader limits reads to three scopes and seven days (targeted
history supports one scope and participant). Its bounded snapshot loader can
serve the app without changing chat formatting. The join writer already
supports a managed scope set and expected membership fence under locks.
Game owns pair visibility, actual chat binding, provider audience preparation,
calendar and completion rules. Membership plus a live grant is required for
health disclosure; revalidate both after decrypting outside transactions.

## Tasks

1. Add bounded two-person, four-scope read and scoped save at the group owner.
2. Resolve pair identity and enrollment at the game owner; derive calendar
   streak and first scheduled date without reading capped history.
3. Use public normalization/window primitives for deterministic source-based
   comparisons and stateless crowns; add authenticated no-store routes and flag.
4. Clarify join disclosure and update the owning product/sharing docs.
5. Prove required math, authorization, race, save and route cases; run affected
   Vitest tests, Web typecheck and changed-file lint. Review the diff and close
   with scripts/finish-task. Parent owns publication and ReviewGPT.

## Product journeys and failure behavior

Current members see only granted values; missing/legacy publication stays
pending. An unjoined seated player sees a shell and can intentionally enroll.
A stale save after leave conflicts. Deselection changes only board scopes.
Blocks prevent access. Old baselines become explicitly rolling comparisons;
ties and nonpositive changes receive no crown. Today in progress cannot break
the current run. Durable projection work survives signal failure.

## Verification

All five tasks are complete. The final focused run passed **196 tests in seven
files**. Web typecheck and changed-file lint passed. Complexity and documentation
checks passed, and the authored diff passed the identifier/privacy scan.

Exact final commands (run from the repository root):

```sh
DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/murph_test_pair_board' MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/game-board-numbers.test.ts apps/web/test/game-board-postgres.test.ts apps/web/test/hosted-group-store.test.ts apps/web/test/hosted-group-shared-read.test.ts apps/web/test/hosted-group-join-accept-route.test.ts apps/web/test/hosted-group-join-client.test.tsx apps/web/test/game-chat-access-postgres.test.ts
pnpm --dir apps/web typecheck
pnpm --dir apps/web exec oxlint 'app/api/game/v1/people/[memberId]/board/route.ts' 'app/api/game/v1/people/[memberId]/board/sharing/route.ts' 'app/api/groups/join/[joinCode]/accept/route.ts' 'app/groups/join/[joinCode]/page.tsx' src/components/hosted-groups/group-join-client.tsx src/lib/game/board.ts src/lib/game/board-numbers.ts src/lib/game/board-streak.ts src/lib/game/chat-membership.ts src/lib/game/service.ts src/lib/hosted-groups/board-scopes.ts src/lib/hosted-groups/group-store.ts src/lib/hosted-groups/join-post-commit.ts test/game-board-numbers.test.ts test/game-board-postgres.test.ts test/hosted-group-join-client.test.tsx
pnpm complexity:diff
git diff --check
bash scripts/check-agent-docs-drift.sh
```

All commands exited 0. The test run took 8.56 seconds; lint emitted no warnings.
Database tests use a dedicated local test database with the existing migrations,
real membership/grant/consent writes, and encrypted projection serialization.
Provider audience, route evidence, runtime access and wake effects use test
doubles. No live provider or production behavior was exercised.

Coverage includes all four availability states, unjoined enrollment, exact
membership and grant-generation changes during decryption, block changes,
two-source selection, maximum eight-source snapshots, normalized units,
coverage/overlap/staleness, rolling comparisons, intermittent VO2, crown ties
and negative changes, canonical cross-game calendar streaks, off days, late
eligibility, current-day progress, stale membership conflicts, missing consent,
scoped replacement preserving unrelated grants, repeated saves, provider and
binding refusals, post-commit wake failure, latest binding selection, history
caps, and route authentication/no-store/kill-switch behavior. Existing group
reader, join route and join UI regressions also pass.

## Decisions and handoff

- VO2 retains the catalog's median, two-point minimum, 14-day current window
  and up-to-90-day baseline. The baseline ends before the current window:
  a full 90-day baseline inside a retained 90-day snapshot would necessarily
  overlap. See `apps/web/src/lib/game/board-numbers.ts:55` and
  `packages/health-metrics/src/definitions/activity.ts:372`.
- Daily values use the contract's display rounding; comparison means and
  deltas retain precision, matching its fractional comparison example.
  The public steps unit maps to the catalog's canonical count unit before
  normalization; explicit naps are excluded from sleep totals.
- Streak work is bounded to 100 games and 5,000 attempts. Beyond either bound,
  `inARow` is null rather than a truncated count. The independent earliest
  scheduled-day query still returns canonical `firstGameOn`.
- Reviewed the final diff for ownership, authority revalidation, bounded work,
  unchanged chat read limits, and identifier leakage. No new tables, migrations,
  projection kinds, runner changes or dependencies were added.
- Section 3 (private companion numbers) and the native share sheet are separate
  tasks. This task updates the web consent disclosure and the existing product
  owners. No public changelog fragment is added in this bounded backend task;
  the parent owns the combined native release note.
- Parent owns push, PR, exact-head CI, ReviewGPT and merge. This work closes
  with a local scoped commit only; no production or publication action ran.

## Accepted review dispositions (binding)

| # | Finding | Disposition |
|---|---------|-------------|
| 1 | Scoped save through the group owner, keep `expectedMembershipId` fence; `readGroupGameChatAuthority` rejects pairs | **Accepted.** New narrow wrapper in `group-store.ts` manages exactly the four board scopes (replacement within that set, never touches other scopes), takes the observed membership id (null = intentional first join), actor from bearer. First enrollment authority: the viewer holds a current seat in a pair game whose actual `chatContainerMemberId` is this group's runtime member; reuse the game owner's pair check (`gameChatContextCurrent` composition), not the group-only authority. Reuse the post-commit projection signal from the accept route. Reuse the existing self-service join origin ("web" semantics); no new "app" origin. |
| 2 | Group shared reader is a 7-day chat reader (≤3 scopes; history = 1 scope × 1 participant) | **Accepted.** Add an app-facing read composition inside the group owner that reuses the authorized snapshot loader (capture, grant-generation checks, retention, decryption) for the four scopes over the 90-day window, bounded per request, with the viewer's current membership captured and revalidated, crypto outside transactions, and the availability states (`not_granted`, `pending`, `missing`, `available`) preserved. The chat reader's limits and wire shape stay unchanged. |
| 3 | Journal lacks steps and VO2 max | **Accepted.** You tab reads Browser Vault `core` + `metricsIndex` + only the metric buckets for the four canonical keys (all registered metric definitions are already in the replica, 365-day lookback). No runner change, no new shard generation. Browser Vault authority (active access + consent, post-read recheck) as Meals. |
| 4 | Snapshots keep up to 8 sources per metric; reuse window primitives | **Accepted.** Board policy: pick one sufficiently covered public source per person per metric deterministically for both windows (no cross-source filling), then `normalizeMetricValue` + `selectMetricWindowComparison`. Return dated daily points, real window bounds, units, coverage and freshness, not bare weekly arrays. Fixed four-entry direction table (resting HR lower is better; sleep, steps, VO2 higher is better); VO2 max uses its intermittent-measurement policy. |
| 5 | One identity = HostedGroup; drop audience enumeration; enrollment from game view; no readHistory(subject); names/avatars | **Accepted, scoped to 1v1.** Entry point is the pair page: `GET /api/game/v1/people/:memberId/board` derives the HostedGroup from the actual chat binding of the most recent pair game between viewer and subject. No board list or sharing-only boards in v1. The board returns no names or avatars; the app already has them from the authorized game views. Viewer must be a current member to see the other person's numbers; a non-member gets only the enrollment affordance. |
| 6 | "In a row" must use the game owner's completion/calendar primitives | **Accepted.** Rule: current run of dates where every scheduled game day the person had in this pair's games was credited (`completedEntry`, `eligibleFromDay`, `termsForDay`/`isScheduledDay`, frozen time zone, 3 AM boundary); dates with nothing scheduled are skipped; today does not break the run until it is over. No stored streak. |
| 7 | Rolling 90 days cannot keep a first-game baseline; grantedAt is not history | **Accepted.** Return `firstGameOn` (canonical Day 1) separately from the actual comparison bounds; when the first game is older than the retained window, the comparison is the rolling window and is labelled so. Stateless crowns: largest positive improvement with enough coverage; exact tie or no positive improvement = no crown. No "kept until beaten" wording. |
| R | Rollout: game door, freshness, flag | **Accepted.** Both 1v1 players pass the game door. `MURPH_GAME_BOARD_ENABLED` is a kill switch (on unless `false`). Pending or missing projections show as pending, never as "not shared". |
| Q4 | Consent copy | **Accepted.** Join page and native share sheet copy name who sees it (the people in this chat, in the app and in the chat), the selected numbers over the last 90 days, and that they're compared; revocation stays one tap. |
| Q6 | Per-round group prize | **Deferred** (group-only; pair history already carries each game's stake). |
Completed: 2026-11-04
