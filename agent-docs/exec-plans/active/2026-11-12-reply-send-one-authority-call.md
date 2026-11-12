# Reply send: one authority call instead of three

Status: active
Created: 2026-11-12
Updated: 2026-11-12

## Goal

Cut the time between "the model finished the reply" and "Linq accepted the
send" by deleting Web round trips that repeat work, without weakening any send
authority rule. Net code should go down, not up.

## Measured starting point

Production, four days ending 2026-11-12, replies with no bubble pacing
(runtime turn-timing rows joined on delivery intent):

| Segment (direct replies, n=157) | p50 | p90 |
| --- | ---: | ---: |
| Provider result to send attempt | 791 ms | 1693 ms |
| Provider result to reply queued | 215 ms | 479 ms |
| Queued to foreground delivery phase | 74 ms | about 230 ms |
| Foreground phase start to Linq dispatch | 439 ms | 952 ms |

Linq's own accept time after the attempt is 125 ms p50 (733 ms p90 for direct).
Group replies add the intentional 4 s draft hold and are otherwise the same.

A container log for one direct iMessage reply shows where the time goes. After
the provider result the runner calls `POST
/api/internal/hosted-runtime/linq-egress/engagement` three times on the normal
path, serially:

1. Turn-commit probe, before the turn is committed and the reply is queued
   (`assertTurnCommitAuthority` in `assistant-engine` `local-service.ts`,
   implemented by `assertHostedAssistantLinqTurnCommitAuthority`). Sent for
   every direct iMessage input that has a `replyToMessageId`. This is the
   215 ms p50 "result to queued" segment.
2. Route authority check, `authorityCheckOnly: true`
   (`callbacks.ts` send dependency). Average 281 ms.
3. Provider entry fence, `authorityCheckOnly: false`, with
   `expectedResolvedRoute` from call 2, issued from the fetch boundary's
   `onProviderDispatchEntered`. Average 201 ms.

Calls 2 and 3 account for all of send preparation in 260 of 285 sampled sends.

What the Web route does (`apps/web/app/api/internal/hosted-runtime/linq-egress/engagement/route.ts`):

- Calls 2 and 3 run the same transaction: the same chat and home-route
  advisory locks, route resolution, instant-first-turn veto, line health
  policy, Assistant Ask authority, proactivity pause. The only difference is
  that call 3 also runs `claimHostedLinqEngagementProviderDispatchTx`, which
  writes the provider-dispatch fence row. Call 2's one output the runner uses
  is `resolvedRoute`, which it passes back as `expectedResolvedRoute`.
- A claiming call already returns `resolvedRoute`. Today it rejects a route
  that differs from the requested target
  (`HOSTED_LINQ_EGRESS_RESOLVED_ROUTE_MISMATCH`), and group-move alias and
  home-route fallback resolution are allowed only when
  `authorityCheckOnly` is true.
- Call 1 is recognised by shape (`isHostedLinqTurnCommitProbe`: authority-only,
  no intent, no idempotency key, no purpose). Its only distinct effect is the
  instant-first-turn rule: it fails when Web owns or already answered the exact
  inbound, and it passes a held input once a later member message exists. With
  no instant-first-turn delivery row for the inbound event the disposition is
  `available` and the probe cannot fail on that rule. Web created 87
  instant-first-turn deliveries in the last 14 days (about 6 a day); every
  other direct iMessage reply pays the round trip for a check that cannot
  veto. The same veto runs again inside calls 2 and 3.

## Proposed design (first draft; superseded by "Revised design after review" below)

### A. One claiming call per send (delete call 2)

Runner (`createHostedAssistantLinqSendDependency` in `callbacks.ts`):

1. Do all fallible local preparation first: liveness, private Assistant Ask
   route assertion, vault file and vault image preload.
2. Make one engagement call with `authorityCheckOnly: false`. It authorizes,
   resolves the route and claims the dispatch.
3. Run the vault-file identity check against the returned route, build the
   request from the returned route and send. The fetch boundary keeps only the
   local liveness and yield assertion; `onProviderDispatchEntered` stops
   calling Web and only stamps the attempt and writes the timing row.

Web (`engagement/route.ts`, `linq-egress-engagement.ts`): a claiming call
without `expectedResolvedRoute` may resolve the route the same way the
authority-only call does today (group-move alias, home-route fallback, target
canonicalisation). `expectedResolvedRoute`, when a caller still sends it, keeps
its exact-match rule. No new field, table or endpoint.

Deletes: the authority-only send call, `readResolvedEngagementInput`,
`routeAuthorityCheckMs` plumbing and the `deliveryRouteAuthorityCheckMs`
timing field, and the Web restriction that ties alias and fallback resolution
to `authorityCheckOnly`.

Claim-before-build is the one semantic change. Today the claim is written when
the first provider fetch begins; with this change it is written one local step
earlier (request build). A failure in that step leaves a claimed dispatch with
no provider entry. The existing contract already covers a claimed dispatch
that is retried: the retry sees "already started", `providerDispatchRetrySafe`
is true for message sends, and Linq dedupes on the idempotency key. Moving the
fallible local work ahead of the call keeps that window to synchronous request
construction.

### B. Turn-commit probe only when Web may own the inbound (delete call 1 for almost every reply)

Web knows when it accepts an inbound whether it claimed an instant first turn
for that exact event (`claimHostedLinqInstantFirstTurn` in
`webhook-service.ts`). Options, simplest first:

- B1 (preferred if the ordering holds): the mailbox item for that inbound
  carries a boolean that Web sets when an instant-first-turn delivery row
  exists for the event. The runner runs the probe only for inputs with the
  flag. Requires proof that the claim row is always written before the mailbox
  item is readable by the runner, including webhook replay.
- B2: delete the probe and let the send-time veto be the only fence. Rejected
  unless review shows the committed-but-never-sent turn is harmless: the probe
  exists so a reply Web already answered is not committed into the session.

### C. Not proposed

- Parallelising or caching authority checks: adds state and ordering questions
  for less gain than deleting the calls.
- Changing the 4 s group draft hold: product behaviour, not latency debt.
- Tuning the Web transaction itself: after A and B one call remains per send;
  revisit only if it is still the dominant cost.

## Expected result

Direct replies: about 215 ms (B) plus about 280 ms (A) off a 791 ms p50, so
roughly 300 ms p50 from provider result to send attempt. Group replies: about
280 ms off, before the hold.

## Success criteria

- A normal direct or group reply makes exactly one engagement call between the
  provider result and the Linq request, proven by a call-count test and by
  container logs after deploy.
- Every existing veto still blocks at send: instant first turn, route
  mismatch, line health, opt-out, proactivity pause, Assistant Ask authority,
  game proposal currency.
- Production p50 from provider result to send attempt for direct replies is
  under 450 ms over a two-day window after the runner deploy.

## Scope

- In scope: the Linq message send dependency in
  `packages/assistant-runtime/src/hosted-runtime/callbacks.ts`, the turn-commit
  probe wiring in `workspace-assistant-phase.ts`, the engagement route and its
  library in `apps/web`, their tests, and the owner docs that describe the
  send-time fence.
- Out of scope: reactions, progress updates, voice memos, typing coverage,
  Telegram, the delivery outcome record call, group draft hold.

## Constraints

- Web must deploy before the runner (the runner starts sending a claiming call
  with no `expectedResolvedRoute` for routes that need resolution). Old runners
  keep working against new Web unchanged.
- No new persisted state for A. B1 adds one boolean to an existing mailbox
  item shape and its hosted-runtime whitelist.
- The dispatch fence row and its idempotency rules are unchanged.

## Risks and mitigations

1. Risk: a claim written and then no provider entry (local failure between
   claim and fetch).
   Mitigation: move fallible local work ahead of the call; rely on the existing
   already-started retry contract; add a test that a post-claim local failure
   retries to a single Linq request.
2. Risk: allowing route resolution on a claiming call widens what a claiming
   call can authorize.
   Mitigation: resolution uses the same function and locks as today's
   authority-only call inside the same transaction; the runner sends to the
   returned route only. Tests cover alias, home-route fallback and a changed
   route.
3. Risk (B1): an inbound that Web owns reaches the runner without the flag.
   Mitigation: prove write ordering; the send-time veto still blocks the send,
   so the failure mode is a committed turn that does not send, which is what
   happened before the probe existed.
4. Risk: deploy skew, new runner against old Web.
   Mitigation: Web first; the runner change ships in a later release.

## Tasks

1. Done: ReviewGPT review of this plan, findings recorded below.
2. Confirm the route fact named in the revised design against the Web route
   and a PostgreSQL-backed test.
3. Runner: single claiming call for ordinary sends in the Linq send
   dependency; all other shapes unchanged; tests including call counts and a
   post-claim local failure that retries to one Linq request.
4. Deploy the runner (Web is already compatible); measure the direct, unpaced
   cohort against the success criteria.

## Plan review (ReviewGPT, 2026-11-12)

Static review of the first draft. Verdict: revise before implementation.
Response saved locally at `audit-packages/plan-reply-send-one-authority-call.md`.

| # | Finding | Outcome |
| --- | --- | --- |
| 1 | A claiming call that resolves a home-route fallback would lock the stale requested chat, not the resolved chat, and can race group isolation (`demoteHostedMemberLinqGroupChatBindingsTx` checks unresolved dispatches under the resolved chat's lock). | Accepted. `lockGameEgressRouteTx` takes the lock target from `expectedResolvedRoute` or the request target. Home-route fallback and alias sends keep today's two calls. |
| 2 | B1 copies "no instant-first-turn row at publication" into a durable hint, but a webhook replay after access recovers can create the first exact-event row after the inbound is published. | Accepted. B needs an explicit ownership decision (close new exact-event claims at mailbox publication) before any hint is sound. Out of this change. |
| 3 | A B1 hint must survive parser, import, snapshot restore and replay; absent must mean "probe", and it belongs in the hosted mailbox input item record, not generic input source metadata. | Accepted as the shape B must take if it is ever built. |
| 4 | Preloading approved vault files consumes the approval; moving it ahead of route resolution consumes approval for an incompatible route, and a terminal identity conflict after an early claim strands an unresolved dispatch fence. | Accepted. Vault-file sends keep today's order and two calls. |
| 5 | A card send can involve a capability lookup and a separate fallback identity with its own claim. | Accepted. Card sends are unchanged. |
| 6 | The private Assistant Ask assertion runs at every provider fetch and is a different authority from the engagement call. | Accepted. It stays in `assertProviderEntryLive`; reviewed and private Assistant Ask completions keep today's path. |
| 7 | A one-call runner cannot proceed from Web's legacy already-started error, which carries no route. | Accepted. Web compatibility floor: Web first, and on rollback the runner goes back first. |
| - | The 300 ms p50 estimate is a hypothesis; subtracting segment medians does not give a new median. | Accepted. The acceptance criterion is the measured cohort, and A alone will not reach the combined figure. |
| - | B2 (delete the probe) stays rejected: a send-time veto cannot undo a committed turn. | Accepted. |

## Revised design after review

Only A, and only for ordinary message sends. An ordinary send is a Linq text
or media message with: a thread target taken from the current delivery
context, `homeRouteFallbackAllowed` not set, no card, no vault file, and not a
reviewed or private Assistant Ask completion. Reactions, progress updates and
voice memos are unchanged.

For an ordinary send the runner makes one engagement call,
`authorityCheckOnly: false`, with the request's own target and no
`expectedResolvedRoute`, at the point where the authority-only call is today.
Web already accepts this shape, locks the requested chat, rejects before
claiming when the resolved target differs from the requested one, and returns
`resolvedRoute`. The runner builds the request from the returned route and
sends. The fetch boundary keeps `assertProviderEntryLive` unchanged and no
longer calls Web for these sends; attempt stamping stays at provider entry and
the fence timing start moves with the claim.

Every other send shape keeps the current two calls, so no Web authority rule,
lock or transaction changes in this iteration. Whether Web needs any change at
all depends on one fact to confirm first: that a claiming call with no
`expectedResolvedRoute` on a current-conversation reply resolves to the
requested target today (no alias, no fallback, no canonicalisation difference).
If it does not, this plan stops and is re-reviewed rather than relaxing the
route-mismatch rule.

Deletes for the ordinary path: the authority-only round trip (about 280 ms
average). Kept: `readResolvedEngagementInput`, the route-authority timing
field and `expectedResolvedRoute`, because the surviving branches use them.

B (turn-commit probe) is not in this change. It stays on every direct iMessage
reply until the owner decides whether mailbox publication should close new
exact-event instant-first-turn claims.

Call counts to assert, from provider result through the first Linq message
request:

| State | Direct reply | Group reply |
| --- | --- | --- |
| Today | probe + authority check + claim | authority check + claim |
| After this change, ordinary send | probe + claim | claim |

## Decisions

- 2026-11-12 implementation: the PostgreSQL-backed route proof passes for both
  direct accepted ingress and a durable group route. A claiming request without
  `expectedResolvedRoute` returns the requested target, creates one fence, and
  returns the same route with `providerDispatchClaimed: false` on replay. No Web
  production code, locks, mismatch rule or turn-commit probe changed.
- Ordinary eligibility derives from the existing matching delivery context
  (thread or explicit target; never participant) and matching inbound reply ID,
  with no home-route fallback, card, vault file, reviewed/private completion
  or progress purpose. The first
  call claims; the fetch boundary retains liveness and attempt stamping.
  Route-authority timing is zero on this path and fence timing starts at the
  claim. All surviving branches retain their existing calls and timing.
- Outcome: remove one serial authority round trip from ordinary replies.
  Reaches: direct/group text and media replies. Proof: real outbox call counts,
  PostgreSQL route/fence replay, unchanged veto and ordering tests, retry after
  local liveness loss, and dispatch timing. Product UX verdict: Ready for PR;
  production latency and provider acceptance remain post-deploy evidence.
- Candidate review found that prepared delivery contexts can also come from
  stored group-route authority, including a retired alias with no reply anchor.
  Require the existing inbound reply ID for the ordinary path: Web only prepares
  group-move aliases when that ID is absent. Unanchored sends keep two calls,
  preserving alias resolution without introducing any new state or route rule.
- The current Web response contract is the compatibility floor. Older runners
  retain two calls against current Web. A legacy already-started error without
  a route cannot serve the new ordinary path: roll back the runner before Web
  if reverting that response contract. No deployment is part of this task.
- The brief explicitly excludes merging, deployment and ReviewGPT. Keep this
  plan active for the deployment/measurement task; commit through
  `scripts/committer` as requested. No new state, schema, config or API fields.
- Model input, prompts, tools and reply content do not change; deterministic
  delivery proof applies, so no real-model journey is needed.

- 2026-11-12: plan review findings 1 to 7 accepted as recorded above; scope
  reduced to ordinary message sends with Web unchanged.
- Open, owner decision: whether to pursue B by changing who wins the rare
  replay race for an already-published inbound.

## Verification

- PostgreSQL migrations applied to an isolated local test database (exit 0).
- Web: `DATABASE_URL=<LOCAL_TEST_DATABASE> MURPH_TEST_POSTGRES_CONCURRENCY=1
  pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage
  apps/web/test/hosted-runtime-reply-claim-postgres.test.ts
  apps/web/test/hosted-onboarding-linq-egress-engagement.test.ts
  apps/web/test/hosted-runtime-linq-delivery-route.test.ts`: 273 passed, exit 0.
  Authentication alone is stubbed in the new proof; route resolution, locks,
  mailbox reads and dispatch writes use migrated PostgreSQL.
- Focused real-outbox call/retry proof: direct text and media use probe + claim;
  group text and media use claim only. A retryable local failure after claim
  preserves the outbox retry, records no early provider attempt, and retries
  against `providerDispatchClaimed: false` to one Linq message request.
- Runtime: `pnpm --dir packages/assistant-runtime exec vitest run --no-coverage
  test/hosted-runtime-callbacks.test.ts
  test/hosted-runtime-linq-outbox-regression.test.ts
  test/hosted-runtime-linq-audio-e2e.test.ts
  test/hosted-runtime-linq-document-preservation-e2e.test.ts
  test/hosted-runtime-workspace-assistant-phase-scheduling.test.ts`: 412 passed,
  exit 0. Existing unchanged-path veto/order tests are untouched. The new
  unanchored alias test asserts authority + claim, and ordinary timing tests
  include exactly the simulated Web claim duration in the fence metric.
- `pnpm --dir packages/assistant-runtime typecheck` and
  `pnpm --dir apps/web typecheck`: both exit 0.
- `pnpm --dir apps/cloudflare runner:bundle`: exit 0; entry 71,194 bytes,
  static boot closure 2,035,354 bytes, 24 chunks; all bundle budgets passed.
- `pnpm --dir apps/web changelog:generate` and
  `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage
  apps/web/test/changelog-page.test.tsx`: exit 0; 4 tests passed.
- `pnpm complexity:diff`: exit 0; source complexity debt 154 to 153 and maximum
  73 to 72. Repeated optional dependency/media defaults are normalized once in
  the existing send function; no helper abstraction was added.
- `pnpm docs:drift` and `git diff --check`: exit 0. Parent review covered
  the full diff, target provenance, alias exclusion, compatibility, retry,
  unchanged provider-entry liveness and privacy. No new Frog entry was needed.
- Not performed: production queries, latency measurements, real provider sends,
  merge, deployment, or ReviewGPT. Earlier combined A+B latency estimates and
  Web-first changes are superseded by the revised scope; no numeric latency
  improvement is claimed from local call counts.
