# Reduce scheduled automation database load and spread daily maintenance

Status: active
Created: 2026-09-21
Updated: 2026-09-21

## Outcome and scope

Reduce database round trips for scheduled work by at least half in a representative synthetic callback workload, with a two-thirds reduction as the preferred target. Spread new and existing Personal Patterns maintenance across stable daily slots. Keep background maintenance on Flex on retries; preserve standard-tier fallback for ordinary reminders. Investigate provider failures using bounded private diagnostics without copying production records into artifacts.

## Architecture

- Owners: canonical automation schedules and cron runtime state own cadence and occurrences; Web access and usage owners retain policy; Prisma owns relational query execution.
- Smallest correction: consolidate equivalent relational reads and reuse request-local facts; derive deterministic schedules using the existing stable vault identity; classify existing immutable managed identities for Flex retries.
- No new durable state, cross-request authorization cache, provider queue, or production mutation.
- Preserve signature/nonce admission, live effect authority, consent, group participant authority, pending delivery, and running occurrence ownership.

## Product UX

- Existing and new members receive daily background maintenance without a shared daily start minute. User-selected schedules and paused records retain their intent.
- Running, retrying, and pending-delivery occurrences finish without duplication before migration; migrated cadence begins after the current local day.
- Background capacity failures retry on Flex. Ordinary user-created reminders retain standard-tier fallback. Foreground conversation behavior and group privacy remain unchanged.
- Proof: canonical schedule readback, due occurrence and terminal outcome, deterministic tier and suppression checks, focused production-derived assistant journey.

## Tasks and proof

1. Trace expensive callback reads; measure baseline and optimized SQL counts using synthetic local PostgreSQL data, including direct, sponsored, and group access.
2. Implement bounded query reduction and test policy equivalence, denial, revocation, and request freshness.
3. Implement stable daily spread and legacy schedule migration, with timezone and in-flight regression coverage.
4. Keep maintenance retries on Flex; preserve reminder fallback and bounded retry behavior.
5. Run focused tests, relevant typechecks, live assistant proof where applicable, complexity and candidate review; prepare PR and start ReviewGPT concurrently with CI.

## Risks

Joined relation reads may shift CPU cost to PostgreSQL; measure latency and query plans as well as round trips. Schedule edits may reset occurrence state; use the cron authoring lock and defer in-flight work. Do not claim a production percentage from a synthetic benchmark.

## Evidence

- Real local PostgreSQL: sixty mixed direct, sponsored, and group-container access/usage checks use 1,380 → 440 statements in mutating mode (68% fewer), and 820 → 180 in read-first/read-only modes (78% fewer). Baseline uses the previous Prisma relation strategy with the same request-local reuse, so this isolates relational round trips. This is not a full automation-burst benchmark or a production percentage. Local timings varied; CPU/latency improvement is not established.
- Joined and previous-strategy decisions match. Fresh consent withdrawal denies the next owner and container requests in every mode. Existing PostgreSQL member access, usage-period, access-lock ordering, concurrent usage, participant reconciliation, and mailbox denial proofs pass.
- Managed schedule and cron integration: 361 tests pass, including stable identity across moves, sixty-member spread, three timezones, next-day first occurrence, four in-flight states, preserved paused/custom schedules, six Flex-retry recipes, and ordinary reminder fallback. Core canonical-record suite: 26 tests pass, including atomic schedule/anchor persistence and optimistic conflict rejection.
- Focused real Codex journey passes on the subscription lane with gpt-5.6-terra: staggered Personal Patterns reads prior covered insight and records a quiet skip. Earlier available profiles failed before provider action; one authenticated profile completed the journey. This proves local assistant behavior, not hosted transport or billing tier.
- Focused Web route/reconciliation/usage tests and Web, Core, and Assistant Engine typechecks pass. Complexity ratchet passes; existing orchestration hotspots retain their prior debt, and extracting the canonical cadence-anchor calculation reduces Core debt by five.
- Parent candidate review covers occurrence ownership, concurrency, privacy, access freshness, provider tier fallback, and global relational-read impact. Final PR, changelog, exact-head CI, and ReviewGPT pending.

## Deployment boundary

No production mutation was performed. Regenerate Prisma Client as part of the ordinary Web build; no SQL migration is needed. Web relation joins and runtime cadence/Flex changes can roll independently. Existing readers understand daily-local schedules and schedule anchors. Rolling back runtime code may reapply the old managed schedule on later reconciliation; retain this cadence policy when rolling back unrelated runtime changes. After rollout, compare SQL volume and database CPU/latency over representative traffic, verify spread convergence, and inspect Flex capacity retry outcomes.
