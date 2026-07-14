# Hosted Reply Liveness: Incident Findings And Final Recommendations

Status: completed
Created: 2026-07-14
Updated: 2026-07-14

## Scope

This is a point-in-time review of the hosted reply-liveness incident associated
with merge `67e98e2c3bf25307227a39e3a3adabe23d403ad0`, the fixes shipped during
the recovery window, and the smallest durable invariant and test changes that
should follow.

It is not a canonical architecture specification. The canonical rules remain
in `docs/contracts/00-invariants.md`.

This review used the merge's first-parent diff, historical source at the merge,
the subsequent repair commits, current `main`, existing owner tests, hosted-local
E2Es, and the repository's secret-safe incident records. It does not reproduce
private production payloads or identifiers.

## Final Decision

The directly observed production outage mechanism was fresh-input starvation:
an older terminal pending item displaced a newly accepted foreground message,
so the model never started for the fresh input.

That selector defect predated the merge. The PR expanded the pending-index and
repair behavior sharing that boundary, but the available production record does
not prove that the selected old item was route-proof work or that PR #528 alone
created the starvation case.

Separately, the most serious merge-specific correctness defect was simple and
severe:

> A default-off rollout flag was allowed to skip a correctness-required
> canonical route write while the same transaction still accepted mailbox work
> that depended on that route.

For an active member whose direct conversation moved from chat A to chat B on
the same owned line, the webhook could commit this contradiction:

```text
accepted inbound and reply target = chat B
canonical member home route       = chat A
```

The optional route-transition proof was safe to gate. The canonical route
mutation was not. The merge's own test explicitly required the flag-off case to
"defer the home mutation but still admit inbound," so the test suite certified
the broken invariant instead of catching it.

No production incident record ties the observed no-provider-start trace to a
specific same-line A-to-B transition, so the route defect should not be called
the sole outage cause. The night-long incident was compound. The merge did not
author every reply failure repaired that night, and several recovery hotfixes
then changed authority and timing boundaries repeatedly. Future incident
records should preserve these evidence levels instead of forcing one PR-only
story onto all observed silence.

The smallest durable response is:

1. Add exactly two general invariant rules: atomic dependent admission and the
   separation of the one-time durable admission decision from mutable effect
   authority.
2. Extend one existing restart E2E to cover a same-line A-to-B transition,
   fresh-before-retry ordering, restart-safe exact reply authority, and
   exactly-once delivery together.
3. Delete the foreground reply path's remaining dependency on the background
   pending index and add one focused malformed-index regression.
4. Close the current concurrent-duplicate quota race with one post-lock recheck
   and one database concurrency test.
5. Add a due-before-idle timing profile to the existing scheduled-reminder CI
   E2E as a P1 integration proof.
6. Inventory and drain legacy delivery intents, then delete their compatibility
   scan and the temporary manual repair surface. Do not expand either.

No new queue, scheduler, repair worker, route owner, authority owner, persisted
proof format, or test-only production behavior is justified.

## Attribution: What The Merge Did And Did Not Do

The first-parent merge diff changed 59 files with 3,385 additions and 122
deletions. That scope crossed admission, mailbox import, pending selection,
runtime maintenance, route repair, cron ordering, deployment configuration, and
tests. The breadth made one optional rollout concern capable of changing the
foreground reply path.

### Confirmed merge-specific invariant violation

At the merge, `apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts`
computed:

```text
shouldCommitHomeRoute =
  no previous home OR route-transition-proof flag enabled
```

The flag was intentionally default-off for rollout. When a previous home
existed and the flag was off, the code skipped `bindHostedMemberHomeLinqChat`
but still called `appendHostedMailboxEnvelopeTx`. It also omitted the optional
`previousHomeChatId` proof. Thus neither the canonical state nor the optional
proof described the accepted transition correctly.

Commit `5aa00c0f61` made the required correction: always bind the admitted chat,
and use the flag only to decide whether optional transition metadata is
emitted. Current code has since deleted the flag entirely. Current ingress now
binds the home route before appending the mailbox item in the same Prisma
transaction.

This defect did not necessarily silence every fresh B input immediately. At the
merge, some fresh inputs carried a `currentInbound` compatibility object that
the web assertion accepted by matching its target. That proof was not durable
enough across all retries and restarts, and other route paths could still reject
the contradiction. The safe conclusion is that the merge committed invalid
canonical state and made legitimate replies and later home-route behavior
dependent on transient compatibility context—not that one line alone explains
every observed production silence.

### Confirmed merge-specific architectural mistake

The merge also embedded legacy reminder-route migration into the reply runtime:

- route-transition proof was carried through accepted input state;
- proof-bearing entries were retained and prioritized in the pending index;
- automatic repair ran in runtime maintenance and before cron work;
- repair backlog, failure, and wake behavior became assistant scheduling
  concerns.

The producer was default-off and later classified as unactivated, so this
machinery is not evidence that automatic repair caused every live failure. It
was nevertheless the wrong architecture: current-message replies and legacy
proactive-route repair acquired shared state, ordering, failure, and scheduling
surfaces.

Commit `1240ecd2a5` removed 2,434 lines of this automatic machinery. Commit
`27ff1b2e3b` retained only an explicit, evidence-bound operator repair path.
That separation is correct. The manual path should also be deleted once a
production inventory proves no eligible legacy routes remain.

### Confirmed incident failures not introduced by the merge

These failures were real and were repaired during the same incident, but the
first-parent diff and blame show that they predated the merge:

1. **Old pending work displaced fresh foreground work in production.** The foreground
   selector merged same-conversation pending IDs with fresh IDs, sorted
   oldest-first, and kept one. Production evidence records a fresh message that
   was accepted, signaled, imported, and eligible, followed by no provider start
   and no delivery effect because an older terminal item occupied that slot.
   `6e1759b3f8` deleted foreground pending merging; `a38e955389` kept system-lane
   notes behind fresh conversation input.
2. **Mutable delivery authority ran before the model.** The Linq pre-model
   filter predated the merge. It could write terminal suppression evidence for
   a route mismatch before the delivery boundary had exact durable facts.
   Recovery commits removed, reintroduced, removed, reintroduced, and finally
   reverted variants of this filter (`51f2e68ad8`, `d34838c470`, `e1147f3238`,
   `d7ba265295`, and `ba8fe5446f`). Recovery records show later variants
   suppressing recovered input, but do not prove that the merge-time filter
   caused every original outage symptom. The stable conclusion is that mutable
   effect authority belongs at provider delivery, not model admission.
3. **Wake/checkpoint ordering could impose the idle delay.** Due assistant work
   could wait behind the ordinary dirty-workspace checkpoint deadline.
   `b109a3b79d` made the checkpoint deadline the earlier of the idle deadline
   and the due assistant wake. This proves a corrected code path, not by itself
   that checkpoint ordering caused the observed no-provider-start trace.
4. **Commit-time follow-ups and recovered delivery context had liveness gaps.**
   `23a0849ae5` restored immediate reruns for newly imported work and persisted
   exact answered mailbox identities into delivery context.

These distinctions matter. Reverting only the merge could not repair all
observed silence, while attributing all four defects to the merge would teach
the wrong prevention strategy.

## What The Recovery Shipped

The durable corrections now present on `main` are:

- **Atomic route and mailbox admission.** Current Linq ingress binds the current
  admitted direct chat and appends its mailbox work in one transaction. Quota-
  denied traffic intentionally does neither, so the contract applies to
  admitted input rather than every webhook.
- **Fresh-only foreground result.** A foreground turn now selects its result
  from the current fresh batch. It still parses the historical pending index
  first; that residual dependency is slated for deletion below.
- **Delivery-boundary authority.** The web-owned provider boundary resolves a
  current owned thread or proves the exact persisted direct inbound. New
  prepared intents carry `answeredMailboxItemIds` across restart.
- **Due-wake checkpoint preemption.** A due assistant wake can advance the
  checkpoint deadline instead of waiting for the ordinary idle interval.
- **Deletion of automatic route repair.** Reply processing no longer runs the
  deleted route-transition proof queue, pre-cron hook, or repair scheduler.
- **Explicit legacy repair only.** Remaining legacy proactive-route repair is a
  manual audited operation, not a prerequisite for a current inbound reply.

No current code path equivalent to the original flag-gated route/write split
was found in normal direct-message admission.

## Smallest Maintainable Target Architecture

```text
authenticated admission transaction (web/mailbox owner)
  -> reuse the existing webhook shape/authentication/ownership decision
  -> update any required canonical route state
  -> append accepted mailbox work
  -> commit
  -> issue a best-effort, replayable wake

runtime (accepted-work consumer; turn and delivery-intent owner)
  -> trust the durable accepted-work record as admission proof
  -> select fresh accepted input independently of background indexes
  -> run the model
  -> persist one delivery intent with complete exact accepted-input identity

delivery boundary (web/provider owner)
  -> resolve concrete target and current effect authority from durable facts
  -> execute the persisted claim through the provider
  -> record delivery or a typed durable non-delivery disposition
```

The ownership rules are:

- Web ingress owns admission and canonical route mutation; the mailbox is the
  durable accepted-work owner.
- The runtime consumes accepted work and owns turn selection and durable
  delivery intent. The outbox/intent owner holds the stable effect claim.
- The runtime does not repeat ingress, provider, network, or mutable-route
  validation before model start. The accepted mailbox record is its admission
  proof.
- The web/provider boundary owns mutable recipient and route authority at the
  irreversible effect.
- A wake is a replayable latency hint, never accepted-work truth.
- Legacy repair is offline operator work and cannot join reply selection,
  provider readiness, checkpointing, or cron ordering.

This architecture composes because each boundary passes stable identities
forward. No downstream layer needs to reconstruct authority from invocation-
local state or repair canonical state before it can answer a current message.

## Exact Canonical Invariant Changes

Only two changes to `docs/contracts/00-invariants.md` are recommended. Existing
rules already cover fresh-work priority, terminal disposition, wake semantics,
bounded work, exactly-once effects, and deployment compatibility.

### 1. Add atomic dependent admission

Add after the first bullet under `Accepted Work And External Effects`:

> When admission changes canonical state that the accepted work requires,
> commit that change and the accepted-work record in one atomic owner
> operation. Optional configuration may add or omit metadata; it cannot gate
> either required write.

This is intentionally provider-neutral. It covers route binding, ownership,
entitlement, and other canonical state on which newly accepted work depends.

### 2. Separate admission authority from effect authority

Replace the first bullet under `Provider And Runtime Boundaries` with:

> The admission owner rejects invalid shape or missing admission-time authority
> before committing accepted work. A valid durable accepted-work record is
> sufficient for model start; the runtime must not repeat route, provider,
> network, or mutable-authority checks before model work. Resolve mutable target
> and effect authority from durable owner facts only at the irreversible-effect
> boundary. Later authority loss takes a typed durable disposition rather than
> retroactively erasing accepted work or spawning repair machinery.

The current wording says invalid routes and unauthorized actions fail before
model or provider work. That conflates admission with mutable effect authority
and can be read as endorsing the pre-model terminal filter that proved unsafe.
The replacement adds no model-path validation: it makes the durable admission
record sufficient and moves mutable checks to the irreversible effect boundary.
It codifies the shape, authentication, and ownership checks ingress already
performs; it does not require another provider call or database round trip.

Do not add Linq-specific, route-transition-specific, reminder-specific, or
incident-specific bullets to the canonical contract.

## Existing Proof And Remaining Gaps

| Contract | Existing proof | Remaining proof |
| --- | --- | --- |
| Same-line direct chat A-to-B rebind | Web routing and dispatch owner tests | No full-stack default-config rebind through restart and delivery |
| Route and mailbox write ordering | Dispatch tests assert calls | Strengthen one owner test to prove the same root transaction and post-commit wake |
| Former-route exact reply authority | Web egress tests cover exact persisted direct input and strict negatives | Existing restart E2E uses one chat, so it does not prove old A after home becomes B |
| Fresh work outranks old pending work | Strong runtime selection tests and the existing restart E2E | Combine it with route movement and former-route retry in one incident-shaped E2E |
| Group, wrong member, wrong line, and unavailable directness fail closed | Existing web and hosted-local group/route tests | No duplicate full-stack permutations needed |
| Due assistant wake beats a longer idle checkpoint | Strong in-process workspace-entrypoint tests | Existing CI reminder profiles checkpoint before due; add one due-before-idle profile |
| Duplicate admission is semantically idempotent | Mailbox append has a dedupe lock | Concurrent identical webhooks can mutate daily quota twice before append dedupes |
| Fresh foreground work is independent of background state | Fresh-only selection behavior is tested | Foreground still parses the unrelated pending index; malformed state can block it |
| New reply intent contains complete exact accepted-input identity | Current callbacks carry `answeredMailboxItemIds` | Compatibility fallbacks can mask a propagation regression; add an owner assertion and consumed-state proof |

The existing CI already runs the relevant restart, scheduled reminder, group
route, and home-line scenarios. The recommendation extends those owners rather
than adding another framework or one E2E per permutation.

## P0 Combined E2E: Extend The Existing Restart Scenario

Extend
`apps/cloudflare/test/hosted-local-retryable-outbox-foreground-restart-e2e.test.ts`.
Do not add a new scenario.

### Setup

1. Seed an active member, owned line L, and direct home chat A.
2. Correct the current fixture so A is bound with the owned `homePhone` as its
   recipient line, not the member's participant phone. The replacement chat B
   must arrive on that same owned line L.
3. Do not configure a route-transition feature flag; the deleted flag must not
   become part of the test contract.

### Fault sequence

1. Admit an old direct input on A.
2. Let the model prepare its reply, then use the existing provider-local
   pre-accept failures to leave a durable retry without an accepted send.
3. Force the existing idle checkpoint and cold restart before the retry is due.
4. Post a fresh explicitly-direct inbound on replacement chat B on line L.

### Required assertions

Immediately after B admission:

- durable home chat is B;
- durable home line remains L;
- no pending route remains;
- the B mailbox item is accepted.

During execution:

- the provider starts for fresh B without waiting for old A's retry deadline;
- fresh B is accepted exactly once on chat B;
- old A has not been silently retargeted to B;
- the prepared old reply later succeeds exactly once on chat A using its
  persisted exact mailbox identity even though B is now home;
- accepted-send order is `[fresh B, old A]`;
- there are exactly two model provider calls: one for A and one for B;
- mailbox lag and pending effects end at zero;
- a quiescence window produces no duplicate send.

After the active mailbox `consumedAt` lane lands, also assert:

- A remains unconsumed after failed delivery and becomes consumed only after
  its accepted retry;
- B becomes consumed only after its accepted send;
- the exact rows named by the prepared intents are the rows consumed.

Those consumed-state assertions prevent the legacy latest-100 scan from making
the E2E appear to prove exact-ID propagation when that propagation has actually
regressed.

This one scenario catches the original skipped rebind, current-home-only
delivery checks, restored pre-model mutable-route suppression, loss of exact
proof across restart, stale-work starvation, unintended retargeting, and
duplicate retries.

## P0 Owner Tests And Small Code Corrections

### Remove the foreground pending-index dependency

Current foreground selection uses only fresh events, but it still calls
`readExistingHostedPendingAssistantInputIds` first. The parser rethrows malformed
state, and a large valid index adds work proportional to unrelated backlog.

The smallest correction is deletion:

- foreground selection reads and returns only the fresh batch;
- foreground input-source refresh does not discover background work;
- background recovery remains the sole owner of the pending index.

Add a focused runtime regression proving that valid fresh input is selected when
the background pending-index file is malformed. A large-index case may remain a
cheap owner test, but do not add full-stack malformed-state injection.

### Independently close the concurrent duplicate quota race

Current active-member ingress performs a fast mailbox dedupe read before taking
the existing per-member route lock. Two identical concurrent webhooks can both
miss that read. The lock serializes route resolution, but the second transaction
can still increment the daily inbound counter before mailbox append dedupes the
item. Repeated overlap can cause premature quota suppression and redundant
wakes.

This is a newly found current liveness bug, not evidence for the original
incident and not a prerequisite for the combined restart E2E.

Keep the fast precheck. After route-lock resolution and before daily quota
mutation, re-read the same mailbox dedupe key and return the existing duplicate
plan when found. Add one real database concurrency test asserting:

- one mailbox item;
- one daily inbound increment;
- one semantic admission;
- the duplicate response/wake behavior remains replay-safe.

Do not create a second idempotency table, lock manager, or webhook state machine.
The existing member lock and mailbox identity are sufficient.

### Strengthen the admission owner test

Amend the existing same-line dispatch test to run through a root Prisma client
and prove:

- route A-to-B and mailbox append use the same transaction client;
- either both commit or neither commits;
- runtime signaling begins only after commit;
- quota-denied input changes neither route nor mailbox.

Keep direct/group, wrong-line, wrong-member, and classification-unavailable
negative cases in their existing owner tests.

## P1 Full-Stack Wake Deadline Proof

The in-process runtime tests already prove the corrected rule. One full-stack
proof is useful because the failure crossed runtime checkpoint publication,
workspace wake state, and orchestration.

Extend the already-CI
`apps/cloudflare/test/hosted-local-linq-scheduled-reminder-e2e.test.ts` scenario
instead of promoting the slower multi-purpose manual latency scenario or adding
another scheduler scenario.

Add one timing profile where the reminder is due before the ordinary idle
checkpoint—for example, a 30-second reminder with a 45-second idle deadline—and
assert:

1. without an inbound message or test nudge, the due assistant wake advances
   the checkpoint by its own deadline plus bounded slack;
2. the reminder sends after that checkpoint and before the ordinary idle
   deadline;
3. the reminder sends exactly once;
4. short quiescence produces neither another reminder nor another service pass.

Adapt the proof to observe checkpoint/send-by-deadline rather than requiring a
future published wake at the instant the checkpoint is already due. Keep it P1:
the owner-level deadline tests are already strong, and the P0 combined reply
scenario closes the incident's highest-value missing proof. No new CI scenario
or matrix leg is needed.

## Compatibility And Cleanup Gates

### Legacy delivery proof

New direct-reply intents should use complete `answeredMailboxItemIds`. Old
intents may still depend on `currentInbound` or a bounded latest-100 live mailbox
scan in `linq-egress-engagement.ts`. A legitimate old prepared reply can lose
authority after route movement if its source falls outside that window or
expires from live mailbox retention.

Do not expand the scan and do not pin mailbox retention around legacy intents.
Instead:

1. prove every newly created direct-reply intent contains its complete accepted
   mailbox identity;
2. inventory nonterminal legacy intents missing that identity;
3. explicitly terminalize or drain them;
4. delete the `currentInbound` and recent-mailbox compatibility paths together.

### Incident-created stale routes and manual repair

A duplicate replay of an event admitted by the broken release returns at the
early mailbox dedupe check and does not rebind its stale home route. Exact reply
authority preserves that message's reply, but proactive current-home behavior
can remain stale until another unique same-line inbound or explicit repair.

Run one incident-scoped inventory and use only the retained explicit repair for
proven affected rows. Keep that tool outside reply processing. When production
inventory proves zero eligible active or paused bare legacy routes, delete the
manual CLI, owner operation, and tests together.

### Deploy compatibility

No permanent two-version binary matrix is recommended. For future cross-plane
protocol changes, apply the existing deployment invariant:

- deploy tolerant consumers before required producers;
- state the warm-old-bundle and rollback floor;
- keep compatibility legacy-facing and temporary;
- remove it after verified drain.

Correctness-required canonical writes must never be a rollout compatibility
mechanism. Only optional metadata may be gated.

## Complexity Budget And Explicit Non-Goals

Do not add:

- an automatic route-repair queue, index, sweeper, worker, or state machine;
- route repair or reminder migration in foreground selection, provider
  readiness, checkpointing, or cron ordering;
- another canonical route owner or delivery-authority owner;
- a pre-model filter based on mutable recipient or route authority;
- a correctness feature flag around canonical writes;
- another persisted route-transition proof format;
- a second idempotency service for duplicate webhooks;
- a permanent recent-history authorization scan or retention-pinning scheme;
- test-only production routes, flags, protocol fields, or lifecycle branches;
- a second hosted E2E framework or one full-stack test per negative permutation;
- a permanent old/new binary deployment matrix without a current protocol
  migration;
- Linq-specific wording in the canonical invariant contract;
- the explicit manual legacy repair path in normal reply processing.

The preferred fixes are deletion, a post-lock recheck, stable exact identities,
and stronger assertions in existing owners.

## Recommended Implementation Order

1. Re-read the coordination ledger immediately before implementation. Reconcile
   the active hosted-ingress-wake lane before webhook edits; the mailbox
   `consumedAt`/`answeredMailboxItemIds` and branch-only runtime lanes before
   runtime edits; and hosted-local assistant-stub-scoping before E2E edits.
2. Make the two canonical invariant edits.
3. Delete the foreground pending-index read and add its focused regression.
4. Extend the existing restart E2E with the A-to-B incident sequence, including
   consumed-state assertions once available.
5. Independently add the duplicate-webhook post-lock recheck and database
   concurrency test; do not make it a prerequisite for the reply E2E.
6. Extend the existing scheduled-reminder CI scenario with the due-before-idle
   profile after deterministic local proof.
7. Inventory and drain legacy intents and stale routes; delete compatibility
   and manual repair only after their explicit removal gates are met.

No production architecture should be added to support these tests. If a test
requires a new queue, manager, route, or persisted proof, the test design is too
expensive and should be reduced to the owning seam.

## Completion Criteria For The Follow-Up

The follow-up is complete when:

- the two invariant changes are canonical and provider-neutral;
- accepted same-line replacement input commits its route and mailbox atomically
  under default configuration;
- concurrent duplicate input mutates quota once;
- foreground selection has no read, parse, or work dependency on the pending
  index;
- the combined restart E2E proves fresh B before old A and exact once-per-chat
  delivery across restart;
- every new direct-reply intent persists complete exact accepted-input identity;
- a due assistant wake is full-stack proven to beat the longer idle deadline;
- legacy compatibility and manual repair each have measured drain/removal
  evidence rather than becoming permanent architecture;
- no new runtime state owner or background process is introduced.

## Evidence Index

Primary historical commits:

- `67e98e2c3b` — merge under review
- `5aa00c0f61` — always bind the admitted route; gate optional proof only
- `23a0849ae5` — timely rerun and durable answered-input delivery context
- `740657146b` — exact persisted Linq reply authority
- `51f2e68ad8` through `ba8fe5446f` — pre-model authority removal and hotfix
  churn ending at the delivery boundary
- `b109a3b79d` — due assistant wake advances checkpoint timing
- `ea3656254c` — simplify Linq route authority
- `6e1759b3f8` — fresh-only foreground selection
- `a38e955389` — system notes remain behind fresh messages
- `1240ecd2a5` — delete automatic route-authority machinery
- `27ff1b2e3b` — retain explicit audited legacy repair

Current implementation evidence:

- `apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-service.ts`
- `apps/web/src/lib/hosted-onboarding/linq-egress-engagement.ts`
- `apps/web/src/lib/hosted-mailbox/store.ts`
- `packages/assistant-runtime/src/hosted-runtime/turn-input.ts`
- `packages/assistant-runtime/src/hosted-runtime/pending-input-index.ts`
- `packages/assistant-runtime/src/hosted-runtime.ts`

Existing proof owners:

- `apps/web/test/hosted-onboarding-linq-dispatch.test.ts`
- `apps/web/test/hosted-onboarding-linq-routing.test.ts`
- `apps/web/test/hosted-onboarding-linq-egress-engagement.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-turn-input.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`
- `apps/cloudflare/test/hosted-local-retryable-outbox-foreground-restart-e2e.test.ts`
- `apps/cloudflare/test/hosted-local-linq-group-route-drift-e2e.test.ts`
- `apps/cloudflare/test/hosted-local-linq-home-line-reroute-retry-e2e.test.ts`
- `apps/cloudflare/test/hosted-local-linq-scheduled-reminder-e2e.test.ts`

Repository incident records:

- `agent-docs/exec-plans/completed/2026-07-13-sev0-reply-liveness.md`
- `agent-docs/exec-plans/completed/2026-07-14-fresh-input-starvation-fix.md`
- `agent-docs/exec-plans/completed/2026-07-13-pr528-pre-cron-route-repair.md`

## Verification

- First-parent merge diff, historical source, blame, repair history, and current
  implementation were independently re-read for causal attribution.
- Focused hosted-web ingress and delivery-authority suites passed: 157 tests.
- Focused assistant-runtime foreground-selection suite passed: 11 tests.
- `pnpm docs:drift` passed.
- `git diff --check`, referenced-path validation, and privacy/path scans passed.

Completed: 2026-07-14
Completed: 2026-07-14
