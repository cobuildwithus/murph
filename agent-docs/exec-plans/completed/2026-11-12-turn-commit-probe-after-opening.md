# Skip the turn-commit probe after a Web-certified opening closure

Status: completed
Created: 2026-11-12
Updated: 2026-11-12

## Goal and decision

Remove the serial turn-commit engagement call for ordinary direct iMessage
inputs only after Web can prove it cannot acquire a new opening obligation.
Preserve the probe for every uncertified accepted input and every existing Web
opening obligation. This task changes tests and documentation only.

**There is no suitable permanent member-level closing fact enforced today.**
The three-delivery cap is a current-account/current-chat continuation rule,
not a member-wide prohibition. First-contact recovery bypasses it; replay can
resume an existing sealed obligation after the cap. A different chat has a
separate history, and a new account deliberately receives a fresh allowance.
An account's app onboarding completion is not consulted by these claims.

Recommend a bounded opening window derived from the existing member creation
time, with a proposed duration of 24 hours. This is a **new Web eligibility
rule**, not a claim about current behavior. It requires a product decision on
the cutoff before implementation. It avoids a new column, counter, table,
closure write, or background job. If closing immediately after the first full
runtime reply is a requirement, use the durable marker alternative below.
Neither design is implemented or approved for deployment by this plan.

## Scope and protected behavior

- In scope: new-row admission in Web; a Web-certified optional mailbox item
  field; its persistence in the existing hosted input record; the commit hook;
  deterministic and PostgreSQL proof; deploy/rollback and aggregate measurement.
- Excluded: product implementation in this task, PR creation, ReviewGPT,
  production reads/writes, sends, deployments, the sibling one-call send change,
  send-time authority removal, group draft hold, prompts or onboarding copy.
- The last send-time route, access, line-health, pause and dispatch checks stay
  authoritative. A send-time veto cannot undo a committed model turn; deleting
  the turn-commit probe outright remains rejected.
- No customer data or direct identifiers were used. All new fixtures are synthetic.

## Current claim graph and closing rules

Source revision inspected: the task checkout's base, before the proof additions.
The rejected hint and review dispositions were read from the explicitly named
sibling checkout's `2026-11-12-reply-send-one-authority-call.md`; its remote ref
was unavailable locally. That checkout was read only.

| Path | Actual rule and owner | Why it does not certify permanent closure |
| --- | --- | --- |
| First contact | `webhook-service.ts`, `startInstantFirstTurnGeneration()` called before classification after an admission-budget claim, invokes `claimHostedLinqInstantFirstTurn` without `continuationMemberId`. | Only request eligibility, absence of a thread-container route, conflicting reservations and the exact delivery lifecycle guard this path. There is no member lifetime cap or completion predicate. |
| Existing member continuation | `startInstantFirstTurnGeneration(true)` resolves a member before the planner publishes input. `readHostedLinqOpeningContinuation` first checks exact replay, then reads prior delivery rows. | The lookup is speculative; the later claim transaction rechecks the count, but does not persist a closed state. |
| Exact-event first-contact recovery | After planning/enrollment, an active wake plus a recorded model-allow decision calls `startInstantFirstTurnGeneration()` without a continuation member again (`webhook-service.ts`, around line 897). | If no row exists, this can create one. Access recovery/replay can therefore defeat a previously published negative per-message hint. The comment describing recovery as reusing an obligation is not an existence guard. |
| Existing obligation | `hasReplayableOpeningDelivery` accepts an exact idempotency row for the chat with acceptance or ciphertext before checking history/access/predecessor. The common claim code still applies terminal, in-flight and attempt-version rules. | A cap or elapsed opening does not erase Web's exact-event ownership. Sealed payloads resume; accepted rows complete without a new send; held and terminal rows keep their existing disposition. |
| Provider transition | `completeHostedLinqInstantFirstTurn` calls `claimHostedLinqDeliveryProviderDispatchTx` with `expectedAttemptedAt`. | The generic store refuses a missing row when an expected attempt is supplied. This is an existing-row transition, not an additional creation escape. |

The only production creation call for this template without an expected
attempt is the generation reservation in `claimHostedLinqInstantFirstTurn`.
A repository search of the template literal and exported template constant
covered its callers and the shared delivery store. Canary cleanup deletes
eligible empty claims; it does not create them.

The exact continuation rule in `linq-instant-first-turn.ts` is:

1. Require an eligible, nontruncated, nonempty, text-only iMessage request.
2. An existing accepted/sealed exact obligation may enter replay first.
3. Otherwise query at most three other `instant_first_turn_v1` rows for this
   chat, with `attempted_at >= hosted_member.created_at`, excluding this event.
   This is not a member-wide count. The query includes pending, skipped and
   failed rows; it does not count only accepted replies.
4. Require exactly one or two prior rows, every one accepted and carrying a
   provider message lookup key, and current runtime AI access.
5. Read at most three recent live conversation mailbox items in descending
   lane sequence; skip this exact event. The first remaining wake must be a
   confirmed direct self-authored Linq message for this member/chat, whose
   provider ID matches prior delivery evidence and whose single text is the
   canonical welcome (one prior row) or identity question (two prior rows).
6. Under the chat ownership advisory lock, reject a thread-container route and
   recheck the expected count (one or two), unless exact replay is available.
   Release stale empty reservations or reject unresolved conflicts, then claim.

Thus three other current-account/chat rows stop a **new continuation**, while
an absent/noncanonical predecessor or denied access stops it **for that read**.
Neither is the requested permanent closing rule. The predecessor check occurs
before the claim transaction; do not describe it as a fully locked history test.
The history query has no ordering because it is a bounded cap/existence read.

### Lifecycle counterexamples and retained obligations

- **Replay/access recovery:** the recorded exact-event allow path can use the
  unrestricted first-contact shape after publication. No-row-at-publication
  remains unsound. The new PostgreSQL test proves the creation primitive after
  cap exhaustion; it is not an end-to-end webhook/access-recovery test.
- **Deletion/re-signup:** `readHostedLinqOpeningDeliveries` explicitly scopes
  retained delivery evidence by the current account creation time. Account
  deletion removes the member/mailbox; retained delivery evidence must not
  consume a replacement account's opening. The privacy deletion owner is
  `apps/web/src/lib/hosted-privacy/account-data-service.ts`. The history test
  proves this query behavior, not the whole account deletion service.
- **Line moves:** history is indexed by chat lookup candidates, not member.
  Changing only the service line within one chat preserves this query's count;
  a replacement chat does not. This is direct-chat analysis, not permission to
  change the separate group-line-move authority protocol.
- **Stale reservation release:** `releaseStaleHostedLinqInstantFirstTurnAndCheckConflictTx`
  skips only eligible stale empty reservations with an exact-attempt guarded
  update. It retains the row, so it still consumes the history allowance.
  Sealed, provider-correlated and held obligations are not absence evidence.
  Canary deletion of eligible pre-provider claims is another reason a count
  is not a permanent member fact.
- **Old accepted inputs:** closure of new claims cannot retroactively certify
  an input Web already answered or still owns. Even an accepted row with its
  encrypted payload cleared must keep that input uncertified.

There is deliberately no permanent fact about a person across account deletion.
Certificates must be scoped to the authenticated account incarnation and its
mailbox input. A replacement account starts open; an old account's snapshot or
certificate must never be imported into it. A cross-account contact tombstone
would be a different privacy/product contract and is not proposed.

## Designs compared

### A — derived deadline, recommended for the smallest change

Define one fixed server-owned constant, proposed `24 hours`, and let
`deadline = member.created_at + duration`. Once the current account has crossed
that deadline, Web forbids **every new instant-first-turn delivery row for that
account**, on every direct chat. Existing obligations retain their lifecycle.
The predicate uses database time and the application's UTC convention for the
PostgreSQL timestamp without time zone; it never compares naive timestamps to
local process time. Confirm the creation-time convention in implementation.

This adds an eligibility boundary to the existing claim owner, not a runner
inference. Older-than-deadline alone has no authority until that owner enforces
it. A clock moving backward across the cutoff or increasing the duration would
invalidate existing certificates; the rollout contract must prohibit both
while such certificates can be consumed. If that operational constraint is
unacceptable, choose B. Do not silently stretch the duration later.

Implementation requirements:

1. Pass participant identity context to new-row admission; the current request
   has only contact kind and is insufficient to resolve an account. Use the
   existing participant -> chat lock and direct identity/home-route lookup.
   Re-read identity after locks; never trust `continuationMemberId` or a stale
   missing-member result as authority. Ambiguity fails closed to the probe.
2. If an exact delivery exists, preserve replay rules. If none exists, resolve
   the current member and check the deadline before the sole insert. Apply
   this guard to continuation, speculative first contact and recorded-allow
   recovery alike. Missing-member first contact remains possible only after
   the locked canonical lookup proves absence; account creation already shares
   participant ownership. A delayed request must not bypass an existing closed
   account by claiming on another chat.
3. Provider dispatch must continue requiring the existing expected-attempt row.
   Do not add another unguarded creation path. Clock/deadline checks must not
   abandon an already-owned sealed response.
4. Web certifies an individual original inbound only when the account is closed
   **and no exact-event instant-first-turn row exists**. Check all chats for
   the event when excluding obligations, so a move cannot hide one. Retain
   probes for every row disposition, even a safe terminal fallback; optimizing
   those few cases is unnecessary.

Cost: one new policy constant, a locked identity/age guard at rare claim
admission, a bounded batched certificate read on mailbox fetch, and the protocol/
record plumbing common to both options. No schema migration or closure writer.
Members whose opening finishes sooner keep the probe until the deadline.
After the deadline, a delayed fresh opening continuation goes to the full
assistant instead of the small Web model; existing replies still recover.
This product cost is explicit and needs acceptance.

### B — monotonic member closure marker

Add a nullable `linq_opening_closed_at` to the existing member table. New
accounts default open. Close on the first successful ordinary direct-iMessage
turn-commit probe, after its existing checks, and never clear the marker during
that account's life. Do not infer it from app onboarding, three delivery rows,
account age, absence of a row or absence of history. Future new-row claims
consult it under the same account/route serialization; replay remains allowed.
The same exact-event exclusion is still required for certificates.

Cost: migration and schema contract, an idempotent closure write, a new durable
policy field/read, plus the same claim guards and certificate plumbing. It
closes earlier and does not rely on time monotonicity. Historical accounts can
close on their next successful probe; no speculative backfill is needed.

There is real lock-order work here: engagement currently takes chat then home
route, whereas instant reply completion takes the member row then chat.
Adding a member-row update after engagement's chat lock without reconciling
those orders can introduce a deadlock. Require PostgreSQL two-connection proof
and an explicit common lock order before choosing B. Do not add a second lock
namespace or a side table to conceal the problem. This is why B is not the
minimum-state recommendation.

Rejected smaller-looking shapes: runner-local age/history guesses; a global
cached closed bit; the rejected per-message negative hint; treating a cap as a
permanent fact; deleting the probe and trusting send-time vetoes. Reusing app
onboarding completion also closes before some members' first chat and couples
unrelated product milestones.

## Certificate transport and commit-hook contract

Use an optional `linqOpening: "closed" | "open"` on the existing hosted mailbox
**item response**, then on `HostedMailboxAssistantInputItem`. Emit only
`"closed"` initially; absent/open always means probe. This is Web authority,
not a model-visible fact, generic immutable `sourceMetadata`, or local cache.

Recommended producer: decorate the authenticated bounded mailbox fetch result.
Read the current account's closure predicate once; batch the fetched original
Linq source events against the delivery source-ref index. The existing mailbox
`dedupeKey` is the producer envelope event ID (`prepareHostedMailboxEnvelopeAppend`),
which can be transformed with `createHostedLinqDeliverySourceRefLookupKey`.
Do not assume every mailbox dedupe key is an original inbound: edits, synthetic
outbound replies and `:consumed-recovery:` identities require lineage validation
or remain absent. If exact identity cannot be proved cheaply, do not certify it.
Use a bounded `IN`/anti-join, not one query per item or an account-history scan.
No provider calls or KMS work while holding database locks.

The lookup is safe after the new admission invariant is deployed: a closed
account cannot gain a new row after this absence read; an existing obligation
is excluded. Before that invariant, this would merely recreate rejected B1.
Do not add an HTTP call to certify; use the existing mailbox response. Measure
its added fetch cost as well as the eliminated commit round trip.

Trace to implement and verify:

1. `packages/hosted-execution/src/runtime-control.ts` and
   `parsers/mailbox.ts`: additive response field, retained only for exact closed
   or open values; absent/unknown values must never become closed. Older readers
   may drop it, which safely restores the probe. Verify every Worker/proxy
   parser and item copy using the actual wire response.
2. `mailbox-import.ts` / `mailbox-conversation-import.ts`: preserve the field
   with its exact authenticated item/user/input binding and pass it to
   `recordHostedMailboxAssistantInputItem`. Do not copy a batch/global value
   onto unrelated inputs. Uncertain lineage loses the certificate.
3. `packages/assistant-engine/src/assistant/hosted-mailbox-input-items.ts`:
   extend the existing v1 optional JSON record/normalizer. SQLite already stores
   `item_json`; no new local table is needed. Cover legacy JSON, rewrite,
   retention, import replay and snapshot round trips. A new observation with
   absent/open must not retain a stale closed value through merge semantics.
4. `workspace-assistant-phase.ts`, `resolveHostedAssistantInputIdsTurnCommitLinqContexts`:
   continue reloading the persisted accepted input events, then batch-read their
   hosted records with `readHostedMailboxAssistantInputItemDetails`. The initial
   in-memory delivery contexts alone cannot carry this authority to commit.
5. At both existing commit-hook call sites in `local-service.ts`, skip the whole
   probe set only for a nonempty set of accepted inputs where **every input**
   has an exact matching closed certificate. Mixed certified/uncertified inputs
   retain today's probes and context deduplication. Non-assistant sources,
   missing records, old inputs and an empty set cannot make `every()` authorize
   a skip. Missing accepted input/context remains the existing retryable error.
   If not all certified, call today's assertion unchanged; do not partially
   optimize a mixed batch in this change.

No change to `assertHostedAssistantLinqTurnCommitAuthority`'s request shape is
needed. Keep its current direct-iMessage/reply-ID filter and its target/message
pair deduplication. The hosted hook can decide whether to call it.

## Deploy and rollback

1. Decide A's deadline or B's marker. Land Web new-claim enforcement first with
   certificate emission disabled; for B deploy the additive migration first.
   Old runners continue probing. Verify recorded-allow replay cannot create a
   row for a closed current member, including a previously absent row.
2. Deploy additive readers through hosted-execution, Worker transport, runner
   import/persistence and the commit hook. Old/missing fields mean probe; old
   runners ignore the field and retain current behavior.
3. Enable Web certification only after all serving Web claim writers enforce
   closure. A new runner against old Web remains conservative. An old queued
   item may be certified by a new authoritative fetch only after exact-event
   exclusion; a previously imported item without the field continues probing.
4. Rollback of the **signal only** restores probes on new/reimported inputs.
   Already persisted valid certificates may still skip, because Web's admission
   invariant remains true. A restored old snapshot lacking the field probes;
   one retaining a valid certificate remains safe under that invariant.
5. Rolling Web back before the new admission invariant is a different action:
   first roll back/disable the runner skip consumer and replace/drain all
   capable runners, including in-flight turns and restore paths. Only then
   revert the Web guard. Merely stopping emission cannot revoke persisted
   certificates. For A, increasing the window is the same incompatible change.
   For B, never clear the marker while a skip consumer is active. Prefer keeping
   the Web guard as the rollback floor instead of adding revocation machinery.
6. Deletion invalidates old account/runtime authority and removes its mailbox;
   new accounts get new input identities and no inherited certification. Test
   an attempted stale snapshot restore across account generations explicitly.

No deployment, rollback or feature switch is performed by this planning task.

## Proof delivered in this task

- Existing focused suites plus the added tests: **99 passed, 3 files**, using a
  newly created, migrated, isolated loopback PostgreSQL test database.
- `hosted-linq-instant-first-turn-disposition-postgres.test.ts`: new proof that
  three accepted rows reject continuation but the first-contact/recovery claim
  shape creates a fourth row and defers runtime egress; new proof that an
  existing sealed row resumes unchanged despite three later skipped rows.
  Real Prisma, migrations and production claim/store code; only provider and
  test crypto seams are synthetic. These tests intentionally describe current
  behavior and must change when the new rule is implemented.
- `hosted-onboarding-linq-opening-history-postgres.test.ts`: production SQL on
  connection-local temporary tables proves account-time scoping, exact-event
  exclusion, pending rows, the three-row bound, different-chat history and a
  replacement account. It does not claim to simulate a line-move transaction.
- Existing PostgreSQL disposition tests exercise fresh/stale reservation
  conflicts, rollback of a skip, exact attempt fencing, sealed resumption,
  definitive rejection, held retries and late positive settlement.
- Existing unit suite proves second/third continuation eligibility, the
  confirmed predecessor, count recheck, group route rejection and suppression
  handoff. Its cap race is mocked; this is not PostgreSQL ordering proof for a
  future member-wide closure rule.
- `pnpm --dir apps/web typecheck:prepared`: passed, including proof-test types.

Commands (local database placeholder contains no production credential):

```sh
MURPH_PRISMA_SKIP_ENV_FILES=1 DATABASE_URL=<LOCAL_TEST_DATABASE> \
  pnpm --dir apps/web exec prisma migrate deploy
DATABASE_URL=<LOCAL_TEST_DATABASE> MURPH_TEST_POSTGRES_CONCURRENCY=1 \
  MURPH_PRISMA_SKIP_ENV_FILES=1 pnpm exec vitest run \
  --config apps/web/vitest.workspace.ts --no-coverage \
  apps/web/test/hosted-onboarding-linq-opening-history-postgres.test.ts \
  apps/web/test/hosted-linq-instant-first-turn-disposition-postgres.test.ts \
  apps/web/test/hosted-onboarding-linq-instant-first-turn.test.ts
pnpm --dir apps/web typecheck:prepared
```

## Implementation proof gates, not yet run

1. PostgreSQL: actual webhook recorded-allow recovery after access restoration,
   with an already published input and no delivery row; no new claim after
   closure. Preserve the old within-window first-contact success path.
2. Two independent connections and explicit barriers: new claim versus closure
   (deadline boundary for A, marker write for B), publication/fetch versus claim,
   old preflight versus replacement account, different-chat claim versus line
   move, and stale empty reservation release. Assert actual rows/commits and
   provider call counts, not elapsed sleeps or mocked lock calls. For A a
   predeadline reservation may finish afterward and must remain uncertified.
3. Every lifecycle disposition and existing-obligation replay after closure:
   accepted, sealed, held, fallback, stale empty, absent. Only absent is emitted
   as closed in this design. Confirm expected-attempt provider transition cannot
   recreate a missing row. Retention and canary reset cannot reopen admission.
4. Original inbound, duplicate, edit and consumed-recovery lineage; no
   certificate through an ambiguous source key or old-account binding.
5. Full mailbox wire parser -> Worker -> import -> SQLite -> reopened/restored
   workspace -> persisted accepted-input hook. Closed makes zero probe calls;
   absent/open/invalid and mixed batches preserve current counts/errors.
   Exercise ordinary result and tool-deferral commit hooks, steered inputs,
   duplicate contexts, missing hosted records, empty accepted sets and old JSON.
6. Real outbox proof: no duplicate Web/runtime reply and no committed model
   turn for an input Web owns. Send-time vetoes still execute for certified
   inputs. Run focused package/Web typechecks and repository-mapped CI.
7. Apply `verify-murph-assistant` during implementation: the new closing policy
   changes which responder handles a delayed opening. After deterministic proof,
   run/review a production-derived synthetic delayed-opening journey, existing
   sealed replay and ordinary established-member reply; no production providers
   or recipients. This plan-only task adds no prompts or behavior and did not
   run a paid model journey.

## Production measurement

The brief's approximately 215 ms p50 probe segment and six daily Web opening
replies are supplied prior evidence, not measurements repeated here. Segment
medians cannot be subtracted to predict a new end-to-end median.

After a separately authorized deployment, use bounded aggregate runtime timing
queries for direct, unpaced iMessage replies. Reuse provider-result, reply-queued,
provider-attempt and delivery-intent correlation. Record sample size, runner/Web
versions, member-age eligibility bucket, all-certified versus fallback, accepted
input count and probe count without message content or direct member identifiers.
Compare matched time windows and report p50/p90 of result-to-queued and
result-to-send-attempt, plus certificate fetch cost and error/retry rates.

Success: all-certified turns make zero turn-commit calls; uncertified turns
retain their existing veto behavior; median result-to-queued improves in the
eligible cohort with no duplicate/unsent committed-turn increase. Keep the
sibling one-call send rollout separate or stratify by version; otherwise its
saving confounds this result. Report the under-24-hour coverage cost for A.
Do not create a new telemetry system; add a finite decision/count to the existing
turn timing owner only if current logs cannot distinguish the cohorts.

## Open questions and readiness

1. Accept a fixed 24-hour Web-opening window, choose another fixed duration, or
   require immediate explicit closure (B)? A deadline is a product change and
   reliance on database time monotonicity is an operational constraint.
2. Confirm the application's UTC creation-time convention and immutable
   `created_at` writers, including account merge/reset tools, before adopting A.
   A writer that moves the same account's creation time forward defeats A and
   requires correction or choosing B; this plan does not certify that audit done.
3. Prove locked identity resolution covers speculative pre-enrollment calls,
   all direct contact forms, line changes and deletion/re-signup. The existing
   claim API lacks participant identity; a caller-only guard is insufficient.
4. Prove exact original-event lineage for certificate projection and the actual
   bounded query/index plan. Keep uncertain identities uncertified. No additional
   immutable source-metadata field or mailbox schema column is preapproved.
5. For B, settle the common lock order before adding a member-row closure write.
6. Verify fleet drain/restore controls for rollback below the Web enforcement
   floor; absence of new signals alone does not revoke persisted certificates.
7. Actual latency/coverage, throughput impact of projection and real-model delayed
   opening behavior remain post-implementation evidence.

Planning verdict: ready for design review, with explicit policy and proof gates;
not implementation-ready on an assumed permanent fact. No current optimization
is safe merely because the three-reply cap was reached. No external review ran.
No changelog entry: this task changes only evidence and a proposed design.
Completed: 2026-11-12
