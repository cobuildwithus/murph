# Type a VO2 max reading in the companion app

Status: completed
Created: 2026-11-06

## Question for review

What is the cleanest long-term way for the native app to write a value a member
types into their vault through the API? The priority, in order, is clean, simple,
long-term maintainable and composable architecture with minimal complexity.

This plan's answer is one more closed action on the existing encrypted
member-action mailbox. Challenge that, and challenge how much of it is needed.
We want the next write of this shape (a weight, say) to cost one schema entry and
one runtime case, without building a framework for writes that do not exist yet.

## Outcome and product rules

Members type a VO2 max into the app instead of texting Murph. No model turn.

- The drawer's "Send Murph a new one" link and its Messages composer are deleted.
- The field shows when no reading exists and when the latest reading was typed
  or reported by hand. It is hidden when a device sends the readings, because
  those members have no need to type one.
- A count rule ("two or more readings hide the field") was rejected: someone with
  no device who typed two readings would have no way to add a third.
- The reading is stamped with the moment it was typed. Tenths are allowed.
- The saved number shows at once. It must not wait for the replica to catch up.
- Texting Murph a reading or a screenshot still works in chat. Only the app's
  link to it goes.

## Evidence

- `packages/contracts/src/member-action.ts`: closed, versioned union. Kinds today
  include `demographics.set`, `display-name.set`, `meal.delete` and two workout
  kinds. `ARCHITECTURE.md` says the envelope "is not an arbitrary path, patch,
  database, or tool-call surface".
- `apps/web/src/lib/member-actions/submit.ts`: `submitMemberAction` locks the
  member, rechecks access and consent, appends one encrypted mailbox item and
  signals the runtime. `outcome.ts` reads the terminal outcome by action id.
- `packages/assistant-runtime/src/hosted-runtime/events/member-action.ts`: one
  `switch` over the kind calls the canonical vault use case directly, with no
  assistant turn, and records the outcome post-checkpoint.
- `apps/web/src/lib/device-sync/companion-demographics.ts` and
  `companion-meals.ts`: each route repeats bearer auth, Browser Vault authority,
  body limits, a replica-generation check and the same `submitMemberAction` call
  with the same `assertCurrentAuthorityTx`. This would be the third copy.
- `packages/vault-usecases/src/usecases/measurement.ts` and
  `packages/core/src/public-mutations.ts`: `addMeasurement` already writes the
  reading the chat path uses. A stable `draft.id` takes the canonical write lock.
- `packages/assistant-engine/skills/aerobic-fitness/SKILL.md`: chat saves with
  `measurement add --metric estimated-vo2-max --unit ml/kg/min --source manual`.
- `agent-docs/exec-plans/completed/2026-11-05-board-vo2-readings.md`: those
  writes already project at day grain into private Numbers and shared boards, so
  no new read path is needed.
- `apps/web/src/lib/device-sync/companion-numbers.ts`: one value per date, last
  row wins; `source` carries `sourceLabel`, which a manual measurement sets to
  the humanized source.
- iOS: `AppSession.sendAgeProfile` already sends, polls
  `member-actions/<id>` for about 12 seconds and falls back to queued. The app
  keeps `enteredAgeProfile` locally until the saved copy catches up.
- Release order: merging auto-deploys Web; the Cloudflare runtime is a manual
  deploy from main; the iOS app ships later through TestFlight.

## Design

1. **Contract.** Add `measurement.add` version 1 to `memberActionV1Schema`:
   `{ metric: "estimated-vo2-max", value }`, with `metric` a closed enum and `value`
   finite and from 10 to 90, inside the 0 to 100 shared VO2 range. The envelope's
   `requestedAt` is the reading's time, so there is no date field. Unit and
   precision stay with the health-metrics catalog. No new rejection reason.
2. **Canonical write.** The measurement writer gains an opt-in keep-existing path:
   under its lock, an id that already has any record, tombstone included, returns
   without writing. Existing same-id upserts stay as they are.
3. **Runtime.** One `case "measurement.add"` writing `source: "manual"`,
   `occurredAt: requestedAt`, the catalog unit and an id from
   `deterministicContractId` over the action id. Created reports `applied`; kept
   reports `unchanged`.
4. **Web.** `POST /api/device-sync/companion/measurements` returns 202 with the
   action id. A thin `submitCompanionMemberAction({ auth, prisma, request })` holds
   the transaction authority callback and id-conflict handling that demographics
   and meals repeat, beside the moved generic outcome reader. Parsing, limits,
   target proof and error wording stay in each route. `requestedAt` more than a
   day from now is refused.
5. **Numbers.** Each series adds `reported` and `latest.observedAt`. `reported`
   comes from one exported manual-source rule shared with the projection.
6. **App.** The field shows with no reading, or when `reported` is true. The typed
   number shows at once and drops when `latest.observedAt` reaches its
   `requestedAt`, on rejection, on a newer entry or on a member change. Retries keep
   the same action id and time; a new entry gets a new one. The send-and-poll in
   `sendAgeProfile` is shared; overlays stay with each feature. `GameVO2TextMurph`
   and the Messages example in `GameVO2AddDrawer` are deleted.
7. **Rollout, consumer first.** PR 1 is contract, canonical write and runtime, with
   no producer. Deploy the Worker and runner and verify them. PR 2 is the Web route
   and Numbers. The iOS build ships last. The decoder and handler are the rollback
   floor. No generation gate and no flag.

## Rejected alternatives

- **A generic vault write API or patch endpoint.** It breaks the stated closed
  action rule and moves validation away from the owner of each record.
- **Sending "My VO2 max is 52" to the assistant from the app.** Costs a model
  turn, adds latency and can fail in ways a typed write cannot.
- **Web writing the vault directly.** Canonical writes belong to the runtime.
- **A new queue, table or result store.** The mailbox already gives durability,
  dedupe and outcomes.
- **A kind named for VO2 alone.** It would need a sibling for each new metric.

## Questions we want answered

1. Is a member action the right long-term seam for app writes, or is there a
   simpler one in this repo that we missed?
2. `measurement.add` with a closed metric enum, or something narrower or broader?
3. Should the shared Web helper be extracted now, at three callers, or is it
   premature? What is its smallest honest shape?
4. Is shipping with no generation gate safe, given Web deploys before the runtime?
   What does an old runtime do with an unknown action kind if a stray call lands?
5. Does an action-id-derived event id give exact replay safety through
   `addMeasurement`, or does it need more? Which failure leaves two records?
6. Two typed readings on one date: does the newest win everywhere (Numbers, board,
   grants)? If not, what is the smallest fix?
7. Is `series.source` a sound way to tell "typed" from "device" on the client, or
   should Numbers say so explicitly? A string compare against a humanized label
   looks brittle.
8. Does `applied` imply the replica has published? If not, is the client overlay
   the simplest correct answer, and when should it drop?
9. What can be deleted instead?

## Proof

- Contract, Web route (auth, bounds, dedupe, 409) and runtime tests, including
  an exact replay writing one record.
- A query test taking the write through to Numbers and the board.
- iOS unit and UI tests for the field, the hide rule and the local overlay.
- Hosted-local proof of a typed reading reaching Numbers, if the stack allows.

## Review outcome

ReviewGPT architecture review, Apollo lane, 2026-11-06. Verdict: keep the mailbox;
no simpler write seam exists. Each finding was checked against the code.

| Finding | Outcome |
| --- | --- |
| P1 stable id alone is an upsert, not a no-op | **Accepted.** `writeAttachmentBackedEvent` appends a new revision on any matched id. Design step 2. |
| P1 Numbers and shared projections pick different same-day winners | **Accepted the risk, rejected the fix.** The gap is only between readings with equal `observedAt`. Both rules compare `observedAt` first, newest wins (`compareMetricPointsForSelection`, `sortMetricRowsAsc`), so a real timestamp fixes typed readings with no `recordedAt` plumbing through Browser Vault, no replica parser change and no fallback for old rows. Reviewer warned against inventing a time to encode order; `requestedAt` is the true moment the member typed it. Two date-only chat readings keep today's behavior, which this change does not touch. |
| P1 Web-first rollout can strand an undecodable item | **Accepted.** Consumer-first, two PRs. Design step 7. |
| P2 Numbers needs explicit provenance and identity | **Accepted the explicit field, rejected the plumbing.** Numbers says `reported` and the app never reads a label. It reuses one exported server rule rather than carrying the source enum through the query pipeline, because `sourceLabelForEntity` is the single producer, the runtime already relies on that literal, and existing replicas work with no rebuild or unknown state. Identity is replaced by `latest.observedAt`, which covers both "my write landed" and "something newer landed" without a record id or an action result. |
| P2 extract authority composition, not a route orchestrator | **Accepted** as a thin wrapper plus moving the outcome reader. |
| Q2 unit and bounds | **Accepted.** Catalog owns the unit; intake stays inside the shared range. |
| Q5 same action id across transport retries | **Accepted.** Design step 6. |
| Q8 `applied` is not publication | **Accepted.** Design step 6 uses observed time, not value equality. |

Codex deep review of both commits found one more, caused by the real timestamp:
measurement points took their day from the UTC slice of `observedAt`, so an evening
reading landed on tomorrow and Numbers hid it until midnight. **Accepted.** Day-grain
VO2 points now use the canonical `dayKey`, the rule observations already follow, and
keep `observedAt` for ordering.


## Backend execution evidence

Scope is Design steps 1–5 in two local commits. The native app remains a later
owner; this plan stays active and the reviewed design remains unchanged.

Consumer proof: contract 22 tests, core workout/measurement 13 tests, runtime
member-action and meal-action 15 tests, hosted-execution decoder 4 tests passed.
Contracts, core, assistant-runtime and hosted-execution typechecks passed after
workspace hydration. Complexity and whitespace checks passed. Replay tests
compare ledger and audit bytes after commit, another reading, correction and
deletion, and prove concurrent identical calls create only one revision.
The existing same-id upsert proof still passes. Runtime readback proves the
manual source, catalog unit, action-derived id, requested time and terminal
applied/unchanged outcomes. No Web caller is included in the consumer commit.


Producer proof passed:

| Owner | Focused Vitest files | Passing tests |
| --- | --- | --- |
| Web | `device-sync-companion-{measurements,demographics,meals,numbers}-route`, `member-action-mailbox-boundary`, `member-action-outcome-route`, `imessage-mini-app-routes` | 166 |
| Assistant Runtime | `vault-share-reported-vo2`, `vault-share-projection` | 160 |
| Health Metrics | `index` | 31 |
| Query | `browser-vault-metric-points-labs-measurements` | 14 |

Each suite used `pnpm exec vitest run --config <owner>/vitest.config.ts
<owner>/test/<file>.test.ts --no-coverage`. Web runs used
`apps/web/vitest.config.ts`; package runs used their package config. An initial
Numbers run exposed old exact-response assertions; they now include the
additive timestamp and the full Numbers suite passes. The first runtime test
needed canonical vault initialization; its corrected real-vault proof passes.

`pnpm --dir packages/health-metrics typecheck`,
`pnpm --dir packages/query typecheck`,
`pnpm --dir packages/assistant-runtime typecheck`, and
`pnpm --dir apps/web typecheck` all passed. Preparation passed with
`pnpm build:workspace:incremental`, `pnpm --dir packages/health-commons generate`,
and `pnpm --dir apps/web prisma:generate`. `pnpm complexity:diff`,
`pnpm logs:guard`, and `git diff --check` passed. The first consumer complexity
check identified the expanded dispatch switch; moving its existing meal error
mapping to a private helper brought the switch below its prior complexity.
No registry, generic write endpoint, feature flag, store, dependency, timestamp
ordering field or source-enum plumbing was added.

Backend journey verdict: Ready. Actual canonical typed actions and real query
replicas prove newest-time selection with both id and input order reversed;
Numbers route proof independently reads real canonical app, chat and device
measurements. Session or consent revocation between initial authority and the
locked append prevents both append and runtime signaling. Existing demographics,
Meals target/body/error paths and outcome post-read checks remain covered.
Canonical replay preserves corrections and tombstones without ledger/audit
changes. Manual provenance uses one exported label rule, with the runtime's
existing provider authority check retained.

`pnpm hosted-local worktree doctor vo2-reading-input` failed because the external
Temporal worker package is not configured (`MURPH_DEV_TEMPORAL_WORKER_PACKAGE_DIR`).
No full hosted-local stack smoke was run; composed real-vault tests are the
next-best local proof. There is no production or live deployment evidence.
Native implementation/tests and public release notes belong to the later app
release; this backend preparation ships no native UI. No model behavior changes
or provider turns are involved. No push, PR, merge or deployment was performed.
The plan remains active for that later work and rollout verification.

## Release record

The owner opted out of the final ReviewGPT gate for these PRs on 2026-11-06, after
Apollo and Vonneumann hit their caps, Eragon offered no GPT-6 Pro and Mountain was
signed out. The plan's architecture review and read-only Codex deep reviews stand
in for it. PR 4692 carried the consumer. This plan closes with the Web producer.
The native field ships from the iOS repo after both.
Updated: 2026-11-06
Completed: 2026-11-06
