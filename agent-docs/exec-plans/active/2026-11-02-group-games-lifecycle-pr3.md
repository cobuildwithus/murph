# Group games lifecycle and settlement

Status: active
Created: 2026-11-02
Updated: 2026-11-02

## Goal and invariants

Implement the authoritative PR 3 lifecycle on final PR 2 storage. One rule engine selects policy by immutable maxPlayers. Preserve pair results and wire contracts; no schema, route, chat or notification expansion. Groups remain admission-disabled in production by default.

## Owners and evidence

`rules.ts` owns scheduling, admission and settlement; `service.ts` owns locked persistence; `command.ts` owns internal validation; the generalized audience owner uses the existing privacy keyring and member resolver. Existing pair-only checks in joining, perfect-result comparison and block termination are the demonstrated gaps. Reuse game row locks, invitation rows, seat arrays and projection masks. No new state owner is needed.

## Tasks

1. Extend internal inputs, addressed audience preparation, rollout admission and immutable identity/rematches.
2. Extend the existing rules for capacity, activation, late eligibility, terms, leave, scoring and shared redemption.
3. Apply commands under existing locks; preserve visibility and deletion ownership.
4. Prove pair compatibility and group concurrency/boundaries with isolated PostgreSQL, focused tests, typecheck, lint, complexity and docs checks.
5. Apply the parent review corrections and verify on the sanctioned PR 3 checkout based on main, which includes merged PR 2. Commit and push, open a draft PR, mark the stable candidate Ready, and complete final ReviewGPT on the vonneumann lane alongside exact-head CI. Do not merge or deploy.

## Failure, privacy and deployment

Prepare crypto outside transactions and revalidate before writes. Group admission locks the complete audience candidate set and the game; joins/leaves settle due state before mutation. Preserve frozen joinedAt and tombstones. No raw addresses or private labels escape their encrypted owners. Persisted group reads, settlement and deletion work with admission off. The current storage cutover is the rollback floor; later PRs own HTTP capability, notifications and chat.

## Product journeys

Starter plus addressed recipients and outside bearers; second acceptance; pre-Day-1 starter edit and stale join; late cross-zone admission; leave before/after deadline; group block/report masks; subset/all-way ties; eligible redemption; same-audience rematch versus outside-bearer refusal. Pair behavior remains under the unchanged expectations.

## Parent review corrections

- Leaving an invited group voids the waiting game. Remove admission support for an empty waiting roster; the second acceptance activates the ordinary path.
- Same again keeps the immutable audience key while omitting invitation rows with neither a member nor a lookup key, including an erased old starter. Preserve surviving invitation seats and task remapping.
- The parent transferred the complete diff onto main `1924bf1635`, including merged PR 2 and its reviewed storage/deletion fixes. The checkout authorization blocker is resolved without bypassing a guard.

## Verification and delivery

Product journeys are Ready for internal testing. Production group admission remains off. No changelog: dark backend behavior with no member-visible release. No schema, wire contract or HTTP changes. PR 4 retains capable serializers, preview shape, leave/terms routes and notifications; PR 5 retains group chat.

Frozen dependency installation, isolated PostgreSQL migration deployment, Web typecheck and lint passed on the new base. `pnpm complexity:diff` passed with zero changed-source hotspots above 20. Focused rules, group PostgreSQL, service, deletion and collection proof passed 5 suites / 192 tests. `pnpm docs:drift`, `pnpm docs:gardening` and `git diff --check HEAD` passed. The isolated `murph_test_group_games_pr3` database was removed after verification.

Prior implementation proof passed all 43 game suites (793 tests), with subsequent focused regression additions passing separately. The final PR evidence will report the new-base counts. Final ReviewGPT and required CI remain pending the pushed candidate. The active plan stays open through that gate.

## Final review round 1

PR #4489 reviewed candidate `1d90cc6a09` on the pinned vonneumann lane. GPT-6 Pro was selected and verified on the accepted message; the full guarded attachment and exact response marker were confirmed. Send-to-capture elapsed time was approximately 373 seconds, above the 80-second marked-response minimum. The exact-turn export matched the captured response. The UI exposed no separate reasoning-time label, so the runbook's marked-response elapsed-time fallback applies. The known metadata-cleanup friction applies; canonical launch inputs preserve the round-one full-snapshot scope and immutable baseline.

One original-PR finding was accepted: a pre-Day-1 leaver retained the old calendar after terms moved the start, making weekday scoring and later joins depend on roster order. A focused rule regression reproduced an incorrect shared prize. Reschedule all retained identified players through the existing schedule owner; departure timestamps and eligibility remain unchanged. Add PostgreSQL proof for persistence, access revocation, later joining, and the correct all-way tie. No new state or abstraction.

CI also exposed the suite's redundant task-specific database-name guard. Remove it and rely on the canonical PostgreSQL runner's existing loopback test-database validation, matching the other game suites. This is test setup only; local verification still uses an owned isolated database. Existing Frog entries cover differing database guards and round-metadata cleanup.

After correction, the five focused suites pass 194 tests. Lint, complexity and documentation checks pass. The one-line production correction reduces filtering without adding a new owner; round 2 will re-send the full sensitive snapshot.
