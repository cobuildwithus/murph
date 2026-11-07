# Recover one missing settled-game recap

Status: completed
Created: 2026-10-31
Updated: 2026-10-31

## Goal and scope

Allow a bound settled game to receive its first ordinary Murph recap after a
rematch starts. Reuse the normal notification, tool, seal and outbox owners.
All work is local, synthetic and uncommitted; no production access or dispatch.

## Implementation

- Remove newest-game rejection only from recap material, sealing and delivery.
- Preserve exact pair/room, runtime fence, receipt, pair/row locks and deletion.
- Use one fixed-target SQL exception in the existing postdeploy migration lane.
  Predeploy SQL is unsafe because old readers could consume the receipt first.
- Keep the existing versioned schedule helpers; prove weekend off days.
- Clarify the existing tie validation correction without changing acceptance
  rules or the recap prompt. The live proof exposed a correction loop: the
  validator rejects owing words even when negated, while its former hint used
  precisely that wording.

## Product UX journeys

Older settled and newest settled games get one saved story and one saved line.
Replay returns the first story. Live games, changed rooms/rosters, stale runtimes,
missing receipts and deleted players cannot gain recap authority. Missed-day and
ordinary game paths retain their current-game rules. No presentation changes.

## Verification

All commands run locally. Initial hydration passed with exit 0:
`pnpm install --frozen-lockfile`, `pnpm build`,
`pnpm --dir apps/web prisma:generate`, and isolated loopback schema hydration
using `pnpm --dir apps/web exec prisma db push`.

Focused Web proof: exit 0, 339 tests across eight files passed:

```sh
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/murph_test_game_late_recap MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/{game-late-recap-postgres,game-service-postgres,game-chat-delivery-authority,game-chat-tool,game-chat-lifecycle,game-recap,hosted-onboarding-linq-egress-engagement,production-migration-guard}.test.ts --no-coverage
```

Additional focused commands:

```sh
pnpm --dir packages/hosted-execution exec vitest run --config vitest.config.ts test/game-chat-notifications.test.ts test/game-tools-compatibility.test.ts --no-coverage
pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts test/assistant-game-tools.test.ts test/assistant-notification-turn-runtime.test.ts --no-coverage
pnpm test:assistant:live -- --test 'game recap notification writes one sealed story and queues its saved chat line exactly; weekends off=true'
pnpm typecheck
pnpm complexity:diff
```

Hosted-execution: exit 0, 29 passed, one pre-existing opt-in incomplete-game
version-skew test skipped. Assistant deterministic: exit 0, 131 passed.
Complexity: exit 0, no hotspots; no new branches in production.
Final `pnpm typecheck`: exit 0. The assistant package typecheck after the final
live-test assertion refinement also exited 0.

Live evidence uses gpt-6.1-sol and local subscription auth, synthetic data and
queue-only outbox delivery. Two stricter pre-fix live runs exited 1: repeated tie
corrections exhausted the turn without a seal and led to invalid-response errors.
The test now models the server's score corrections and records only accepted
writes. The first post-fix run produced one accepted story and one outbox line, and
its exact generated candidate passed the actual Web validator (zero errors).
That run exited 1 solely on an incidental two-attempt cap: the model corrected
missing names and tie wording in separate attempts. The assertion now requires
exactly one accepted write plus the rejected attempts, rather than limiting
legitimate corrections. Final live run: exit 0, one read, two write attempts (one correction), exactly
one accepted seal and one outbox intent containing the saved chat line. Murph
correctly treated the weekend as off. The final candidate also passed the actual
Web validator through local `pnpm exec tsx --eval` (exit 0, zero errors). Product
UX verdict: Ready for the tested synthetic path. This is split-boundary proof:
the live harness uses synthetic tool responses; PostgreSQL proves the actual
seal/receipt and the final candidate is checked separately by the real validator.
No production chat was sent.

Parent review confirms the three newest-game checks were recap-only. The
rematch race remains harmless: a newer game can commit during encryption, but
sealing still takes the pair lock, then the old game row lock, rechecks roster,
room, settled status and departure, and writes only if recap ciphertext is null.
The existing receipt and runtime-generation fence remain required. The old
recap cannot mutate the rematch, and concurrent writers return one first seal.

This is an uncommitted implementation handoff, not a release. No PR, public
changelog publication, remote review, CI, deployment or production verification
was performed under the explicit local-only boundary.

## Deployment

Web only. Promote compatible Web, drain old functions, then the existing Hosted
Web Contract Migrations workflow inserts the receipt. The existing minute sweep
runs the ordinary recap turn. No Worker code or protocol change.

## Progress

Confirmed three newest-game blockers and receipt-only sweep. Existing schedule
projection already uses parseStoredTerms/isScheduledDay. Local install, package
build and Prisma generation passed; isolated loopback PostgreSQL schema ready.

## Completion

Implementation and parent review are complete within the local-only scope.
Diff and authored identifier scans passed. No unrelated edits, commits, pushes,
PRs, dispatches, Cloudflare/Vercel calls or production reads/writes were made.
The local isolated test database remains hydrated for review. Deployment and
verification of the actual game's recap/pages/chat receipt remain unperformed.
Completed: 2026-10-31
