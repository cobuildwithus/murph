# Linq capability egress and fallback diagnostics

Status: active
Created: 2026-08-06
Updated: 2026-08-06

## Goal

- Restore native iMessage nutrition-card eligibility in the hosted runtime by
  admitting the exact Linq capability operation through the existing
  Cloudflare provider-egress owner.
- Preserve deterministic text recovery while making every caught capability
  or definitive app-card failure visible through privacy-safe diagnostics.

## Root-cause evidence

- The response-card sender calls Linq's documented
  `POST /capability/check_imessage` operation before an eligible native send.
- The deployed Cloudflare Linq egress matrix omitted that exact operation and
  returned `403` before provider authorization or upstream fetch.
- The channel runtime intentionally recovered with the existing text-only
  outbox transition, but its catch emitted no diagnostic, so hosted delivery
  appeared successful without recording why the card path was skipped.
- Existing hosted card tests stub provider fetch below the production
  interception boundary and therefore did not exercise the missing route.
- Review of the recovered provider path exposed a second owner-boundary bug:
  a card send marked as possibly accepted was classified as an ordinary retry.
  A later drain could re-enter capability selection and attempt a changed text
  effect under the original card delivery key.
- Final ReviewGPT correction review exposed a third owner-boundary bug: the
  local outbox promoted a rejected card to its fallback key, but the Web
  provider-entry boundary memoized the original card claim for the send. A
  focused runtime test first observed one engagement assertion instead of two,
  and a focused Web test first observed a fallback claim without predecessor
  terminalization. The original `provider_dispatch_started` row could therefore
  remain unresolved indefinitely and block later group routing for that chat.
- Final ReviewGPT round 4 proved that terminally abandoning that ambiguous card
  locally did not resolve the already-claimed Web dispatch fence. The focused
  state and outbox regressions first observed `abandoned` with no retry. Exact
  provider-idempotent replay is therefore required: it retains the card and
  key, skips capability re-selection, and lets provider acceptance close the
  original fence without changing the effect.
- Final ReviewGPT round 5 exposed two replay gaps: detached timer retries do
  not retain a raw recipient phone even though exact replay needs no capability
  lookup, and a structured app-card stale-chat `404` was excluded from both
  definitive rejection and the existing text re-home path.
- Parent review exposed the adjacent process-restart window: Web can persist
  the provider-dispatch claim before the runtime persists its ambiguous local
  result. Re-entering ordinary card selection from that state could change the
  effect instead of first deriving exact replay.
- Final ReviewGPT round 6 exposed three remaining production-boundary gaps.
  The Linq HTTP wrapper replaced a typed hosted confirmation-pending exception
  with a generic transport error that capability recovery could swallow. A
  detached exact replay with a definitively stale chat could persist text
  fallback before resolving an authoritative current direct chat. A native
  card request whose three provider attempts all returned `429` was recorded
  as a definite failure even though provider dispatch had already begun.
- Final ReviewGPT round 7 exposed two restart gaps. The atomic local fallback
  transition cleared the card but retained the rejected chat binding, so a
  fresh process could replay text to the stale predecessor instead of the
  already-authorized current chat. The capability probe also created the Web
  provider-dispatch fence before any message request, so an interruption after
  an ordinary `available: false` result could incorrectly force exact card
  replay on the next drain.
- Final ReviewGPT round 8 exposed that stale-target authorization still reused
  historical reply selectors and ran only when the process lacked a raw
  recipient phone. A retained inbound could therefore re-authorize the dead
  chat, while a live process could commit fallback before rehoming through
  transient phone state. Either path could strand fallback after restart.
- Final ReviewGPT round 9 exposed the remaining same-home loop. When Linq
  rejected the chat that Web still considered current, Web returned direct
  authority without an override, so exact replay retried the rejected chat
  forever even though Web retained the encrypted member identity and assigned
  line needed to authorize a participant-addressed replacement.
- Final ReviewGPT round 10 exposed that an ordinary auto-reply persists its
  answered-mailbox and reply-target selectors across the fallback transition.
  A fresh process treated those historical selectors as route authority before
  current-home projection, so it could send fallback text to the rejected chat
  despite the phone-free participant recovery added in round 9.
- Final ReviewGPT round 11 exposed that one generic fallback identity still
  conflated ordinary app-card rejection with a structured stale-chat rejection.
  Ordinary 400, 415, or 422 recovery could therefore inherit the stale route's
  current-home and participant materialization authority after restart.
- The same round exposed a race after participant projection: if Web installed
  a newer direct home before provider entry, the participant assertion returned
  a permanent authority error even though no provider request had started.
  Inspection through the actual hosted fetch boundary then proved the typed
  retry was itself being replaced by a generic Linq transport error, erasing
  its control semantics and the useful failure classification.
- Final ReviewGPT round 12 exposed that the read-only capability boundary ran
  its pre-request liveness check outside that preservation catch. A foreground
  yield there could therefore be genericized as a capability failure and
  irreversibly clear the native card to text before any provider request.
- Final ReviewGPT round 13 exposed that stale-route recovery still reselected
  the member's current home after Web had already claimed the fallback effect.
  A later inbound could therefore supersede a frozen participant fallback in a
  loop or rewrite a frozen thread fallback before exact claim validation,
  leaving the accepted reply without either card or deterministic text.
- Final ReviewGPT round 14 disproved the participant half of that correction.
  The claimed row froze only the assigned Murph line; every fresh drain still
  decrypted the member's current verified phone. If that phone changed after a
  possibly successful provider request, the same provider idempotency key could
  be replayed to a different recipient. The line-change tests retained the same
  participant and therefore did not exercise the requirement-level identity
  invariant.

## Round 14 requirement retrospective

The original stale-chat recovery requirement is to complete the already
accepted in-chat reply exactly once even when the provider rejects Web's still-
current chat identity. The participant-addressed `/chats` operation is the only
available deterministic recovery when no replacement thread exists, so deleting
that branch would restore the production failure instead of simplifying the
owner model. Re-deriving the participant from current member identity is also
invalid: a provider call may already have begun, and provider idempotency binds
one key to one exact request rather than authorizing the key for a newer phone.

The selected design keeps the participant recovery but makes the existing Web
`HostedLinqDelivery` row the complete effect owner. At the first provider claim,
that row binds the member, source line, provider key, and an encrypted, row-bound
snapshot plus blind index of the exact participant recipient. A later drain
decrypts only that snapshot. Missing legacy snapshot state or any member, line,
recipient, source, or key mismatch fails closed before provider entry; it never
falls back to current identity.

The product disposition after a verified-phone change is exact replay to the
original claimed participant. The member lock proves that recipient was current
when the effect crossed the provider fence, and a later identity change governs
future effects only. This is necessary because the first provider call may have
succeeded before its outcome was lost; changing or canceling the request cannot
undo that effect and would make its idempotency semantics unknowable. Account
deletion remains authoritative: the member relation cascades the delivery row
and its encrypted recipient after the existing runtime/provider cleanup fence.
The schema extension is nullable for rolling deployment and legacy rows, but
new participant fallback claims require the complete snapshot atomically.

## Success criteria

- The Worker admits only `POST /capability/check_imessage` for the new Linq
  capability operation and retains the existing write-fence/provider-token,
  credential-injection, and header-stripping requirements.
- Other methods and non-allowlisted Linq paths remain denied before upstream
  fetch.
- A policy-denied known Linq request emits a metadata-only warning without
  paths, request bodies, recipient data, credentials, or provider response
  text.
- A capability-check exception or definitive app-card rejection emits one
  sanitized hosted warning before the existing persisted text fallback.
- A normal `available: false` result remains an expected fallback and is not
  mislabeled as an error.
- A card-bearing attempt that may already have succeeded enters
  delivery-confirmation-pending and replays only the identical card and key
  without another capability check. It cannot reuse the card delivery key for
  text; only a definitive rejection may promote the stable fallback.
- Exact replay remains valid without a rehydrated raw recipient phone because
  it performs no capability lookup. A structured stale-chat app-card `404` is
  definitive and may promote fallback; unclassified `404` responses may not.
- A resumed non-replay card that encounters an existing Web provider claim
  becomes confirmation-pending before another capability or provider message
  request, so the next outbox drain can derive exact replay.
- Capability probing remains read-only with respect to provider dispatch. Web
  reports an existing exact fence during the authority-only check, and the
  runtime creates or transfers a fence only when an actual Linq message request
  begins.
- Before promoted fallback text enters Linq, Web terminalizes the exact card
  dispatch and claims the fallback in one transaction. A retry from the
  already-persisted fallback repeats that exact transition, and completing the
  fallback leaves no unresolved dispatch fence for the chat.
- Typed hosted delivery-control errors survive the Linq HTTP wrapper and are
  rethrown rather than logged or persisted as capability fallback.
- Every stale-chat replay authorizes the current direct chat before clearing
  the card, without historical reply selectors or process-local recipient
  hints. The same atomic outbox write stores that current chat binding and
  recomputes the target fingerprint, so a process restart replays text to the
  authorized chat. The exact predecessor may be terminalized on its old chat
  while the fallback fence is claimed on that current chat. Missing authority
  preserves the card and confirmation-pending state, and provider-side chat
  materialization cannot replace the durable target transition.
- If the rejected chat is still current, fallback-key authority may return the
  exact participant and assigned line derived by Web from encrypted durable
  state. The runtime persists the participant fallback fence before `/chats`
  without storing raw phone numbers, reacquires that authority on every drain,
  and uses the same fallback delivery key. An accepted replacement chat
  replaces only the exact rejected current home; callback replay is
  idempotent, a newer home wins, and missing durable route authority leaves the
  card untouched and confirmation-pending.
- A persisted fallback key forces current-home-only authority even when the
  outbox retains answered-mailbox IDs and a reply-target message ID for
  accounting and receipts. Those selectors cannot authorize the delivery
  target. The projection distinguishes the exact rejected predecessor from an
  already-persisted replacement thread; missing replacement authority makes no
  provider delivery request and remains confirmation-pending.
- An ordinary 400, 415, or 422 rejection uses the stable `:fallback` identity
  and remains pinned to its exact persisted thread across live and restarted
  delivery. It may not use current-home projection, participant recovery, or
  provider chat materialization. Only the structurally classified stale-chat
  `404` uses `:stale-chat-fallback` and receives that replacement authority.
- If a newer direct home supersedes participant recovery before provider entry,
  Web returns a typed pre-provider disposition without claiming or contacting
  Linq. The runtime atomically persists the newer thread under the same stale
  fallback identity, records a metadata-only event, and retries so the next
  drain sends exactly once to that thread. Missing authority remains
  confirmation-pending.
- A newer home may supersede stale recovery only while no fallback delivery row
  exists. Once Web claims the fallback row, its exact thread or
  participant/assigned-line target is the source of truth for every fresh
  drain. A claimed participant row includes its member owner and row-bound
  encrypted recipient snapshot, so later home, assigned-line, or verified-phone
  changes cannot mutate that effect; mismatches and legacy incomplete rows fail
  closed before local persistence or provider entry.
- Every error raised by the pre-provider dispatch-control boundary, including
  the liveness check before capability preflight, emits a sanitized structured
  warning and retains its original typed retry/control semantics through the
  Linq HTTP wrapper instead of becoming a generic provider transport error or
  persisted text fallback.
- Exhausted provider-message `429` responses after dispatch admission are
  confirmation-pending; a capability-only `429` may still select deterministic
  text fallback before message dispatch.

## Scope

- Cloudflare Linq egress operation classification and focused tests.
- Assistant channel fallback diagnostics and hosted provider-effect coverage.
- Hosted runtime-to-Web provider-fence transition and delivery-store coverage.
- Current provider-egress and response-card reliability documentation.

## Constraints

- No new row, queue, retry owner, external provider call, credential, or
  dependency; extend the existing delivery row and engagement transaction with
  the minimum encrypted participant identity needed for exact replay.
- Keep provider request and response bodies, phone numbers, chat ids, member
  ids, idempotency keys, and raw error text out of durable diagnostics.
- Preserve the current single-effect outbox transition and use its existing
  confirmation-pending state for exact provider-idempotent card replay.
- Apply the nullable delivery-claim migration before deploying Web. The old Web
  and runner remain compatible with the added columns. Then deploy Web before
  shipping the Cloudflare Worker and runner bundle together with immediate
  rollout; the new runner must not precede the Web endpoint that understands
  the transition.

## Tasks

1. [x] Add the exact Linq capability operation and policy-denial diagnostic.
2. [x] Add caught-failure diagnostics without changing text recovery.
3. [x] Run focused tests, typechecks, documentation checks, and privacy review.
4. [x] Prove and correct post-claim route reselection for changed home lines.
5. [x] Persist and verify the exact claimed participant recipient after the
   round 14 requirement retrospective.
6. [ ] Push the exact candidate and complete ReviewGPT plus CI gates.

## Verification log

- From `apps/cloudflare`, `pnpm exec vitest run --config vitest.config.ts test/runner-egress-intercept.test.ts`
  — 231 passed.
- From `packages/assistant-engine`, `pnpm exec vitest run --config vitest.config.ts test/assistant-channels-runtime.test.ts`
  — 60 passed.
- From `packages/assistant-runtime`, `pnpm exec vitest run --config vitest.config.ts test/hosted-provider-effects.test.ts`
  — 21 passed after the specialist correction.
- From `packages/assistant-runtime`, `pnpm exec vitest run --config vitest.config.ts test/hosted-runtime-callbacks.test.ts`
  — 210 passed after updating the exact dependency assertions exposed by CI.
- Package typechecks passed for `apps/cloudflare`, `packages/assistant-engine`,
  and `packages/assistant-runtime`.
- `pnpm docs:gardening` and `pnpm docs:drift` passed.
- Diff whitespace and direct-identifier scans passed; the changed diagnostics
  contain no request body, provider response text, recipient or thread
  identifier, delivery key, or credential.
- Preliminary ReviewGPT found one truthful-state issue in the warning copy:
  the pre-transition event claimed completed recovery. The message now says
  text recovery was selected, and a focused persistence-failure regression
  proves the operation rejects without a text send.
- Final ReviewGPT round 1 passed the original candidate with no findings. The
  accepted specialist correction required a correction-delta round. Exact-head
  CI exposed four broader test assertions that did not include the new
  callback; those assertions are corrected and local proof passes.
- Final ReviewGPT round 2 verified the earlier correction and found the
  ambiguous card-attempt changed-effect retry path. The first correction used
  terminal abandonment to prevent capability re-selection and text promotion.
- From `packages/assistant-engine`, `pnpm exec vitest run --config vitest.config.ts test/outbox-dispatch-state.test.ts`
  — 28 passed after the ambiguity correction.
- From `packages/assistant-engine`, `pnpm exec vitest run --config vitest.config.ts test/assistant-outbox-runtime.test.ts`
  — 90 passed before the round 4 correction.
- `packages/assistant-engine` typecheck passed after the ambiguity correction.
- Final ReviewGPT round 3 found that the fallback used the original memoized
  Web provider claim. The two failing-first regressions proved the stale-fence
  mechanism before the correction. The runtime now re-enters Web with the
  predecessor identity after local fallback persistence, and Web atomically
  terminalizes that exact predecessor before claiming the fallback.
- From `packages/assistant-runtime`, `pnpm exec vitest run --config vitest.config.ts test/hosted-runtime-callbacks.test.ts`
  — 212 passed after the fence-transfer correction.
- From the repository root, `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-onboarding-linq-egress-engagement.test.ts`
  — 47 passed, including exact predecessor, derivation, and intent-ownership
  validation.
- The opt-in local PostgreSQL fence lifecycle proof passed: the original row is
  terminalized, the fallback is the only unresolved row while active, and the
  chat has no unresolved dispatch after fallback acceptance.
- `packages/assistant-runtime` and prepared `apps/web` typechecks passed after
  the fence-transfer correction.
- Final ReviewGPT round 4 proved terminal local abandonment stranded the Web
  dispatch fence. Two focused regressions failed with `abandoned` before the
  correction. Ambiguous native-card delivery now uses the existing
  confirmation-pending state and replays the exact card/key without capability
  selection; definitive rejection still transfers the fence before text.
- Focused exact-replay proof passes in outbox state, outbox/channel integration,
  channel runtime, hosted provider effects, and hosted callbacks. The local
  PostgreSQL proof now also shows acceptance under the original replayed key
  clears the unresolved chat fence; both PostgreSQL cases pass.
- Round 5 failing-first proof showed exact replay rejected a detached request
  with no raw recipient phone, structured stale-chat `404` was not classified,
  and an existing Web claim allowed ordinary card selection to continue. The
  corrected focused channel, provider, callback, and classifier regressions
  pass; exact replay now needs only its persisted direct-card identity, the
  structured stale-chat rejection reaches persisted fallback/re-home, and the
  restart window records confirmation-pending before provider message I/O.
- On the round 5 remediation head, the three assistant-engine card/outbox
  files pass 180 tests, the hosted provider/callback files pass 237 tests, and
  the Linq HTTP runtime file passes 47 tests. Assistant engine, assistant
  runtime, and operator config typechecks pass; documentation gardening and
  drift checks pass.
- Round 6 failing-first proof reproduced all three findings through the actual
  channel and hosted provider boundary. After correction, focused Linq HTTP,
  channel, hosted provider, hosted callback, and Web authority tests pass 48,
  63, 26, 216, and 47 assertions respectively.
- The local PostgreSQL lifecycle proof passes both cases, including
  terminalizing the rejected predecessor on a stale chat, claiming fallback on
  a different current chat, and closing that current-chat fence on acceptance.
- Operator config, assistant engine, assistant runtime, and prepared Web
  typechecks pass. The accidentally broadened assistant-engine package run
  completed 3,162 tests before one worker exceeded its 4 GiB heap; the intended
  focused 63-test channel lane passed independently and exact-head CI owns the
  broad suite.
- Final ReviewGPT round 7 found that the authorized stale-chat replacement was
  process-local and that the capability request itself created the provider
  fence. Both failing-first regressions reproduced the restart failures. The
  fallback transition now persists the authorized binding and recomputed
  fingerprint atomically, while a separate capability fetch boundary remains
  read-only and an authority-only Web projection detects only an existing
  exact message-dispatch fence.
- Current correction proof passes: assistant outbox/channel integration 153,
  hosted provider effects 26, hosted callbacks 217, Web Linq engagement 48,
  Cloudflare Linq engagement parsing 1, and local PostgreSQL fence lifecycle 2.
  Assistant engine, assistant runtime, Cloudflare, and prepared Web typechecks
  pass. Documentation gardening and drift checks pass.
- Final ReviewGPT round 8 found that historical reply authority and transient
  phone recovery could still bypass durable current-chat selection. The
  remediation always requests the current-home-only Web projection before the
  fallback transition and disables provider-side phone recovery after that
  transition. Focused live, detached, missing-authority, and fresh-restart
  regressions pass: hosted provider effects 27, hosted callbacks 3, and the
  assistant outbox restart case 1.
- Final ReviewGPT round 9 found that current-home-only authorization still
  looped when the rejected chat itself remained current. The remediation now
  authorizes a participant-addressed fallback from Web-owned encrypted state,
  persists a phone-free participant fence before provider chat creation,
  reacquires the route after restart, and binds an accepted replacement chat
  back to the exact rejected home. Provider entry also rechecks that the
  predecessor chat remains current, closing the race where a newer home could
  appear between recovery authorization and `/chats`. Focused proof passes:
  assistant channel runtime 64, hosted provider effects plus callbacks 251,
  the three affected Web files 131, the full Cloudflare Node workspace 2,264,
  and local PostgreSQL fallback lifecycle 3. All four affected package
  typechecks, documentation gardening, and documentation drift checks pass.
- Final ReviewGPT round 10 found that production auto-reply selectors survived
  restart and bypassed current-home projection. Failing-first runtime proof sent
  toward the rejected thread, while Web proof both authorized the old inbound
  and rematerialized over an already-persisted replacement. The fallback key
  now forces selector-independent projection, Web compares the requested/current
  chat with the predecessor, and missing authority remains confirmation-pending
  before provider delivery. Focused correction proof passes: assistant outbox
  96, hosted callbacks 224, and Web Linq engagement 54. The combined affected
  files pass 160 assistant-engine tests, 252 hosted-runtime tests, and 136 Web
  tests including the PostgreSQL lifecycle; affected typechecks and both
  documentation checks pass.
- Final ReviewGPT round 11 found the ordinary/stale fallback identity collision
  and the concurrent-home participant race. Failing-first proof reproduced the
  ordinary restart re-home and the permanent pre-provider authority failure.
  The correction assigns route replacement only to the stale-chat identity,
  atomically projects a superseding home before a retry, and preserves plus
  logs the typed control error at the hosted fetch boundary. Focused proof
  covers live and restarted ordinary fallback, selector-free fail-closed
  authority, the two-drain supersession race with no first provider request,
  exact Web claim replay, and structured control diagnostics.
- Current round 11 correction proof passes 162 assistant-engine tests, 253
  assistant-runtime tests, 55 operator-config Linq HTTP tests, 135 Web authority
  and callback tests, 145 Cloudflare runtime-platform tests, and all 3 opt-in
  PostgreSQL lifecycle cases. Typechecks pass for assistant engine, assistant
  runtime, operator config, prepared Web, and Cloudflare; documentation
  gardening and drift checks also pass.
- Final ReviewGPT round 12 found the uncovered capability-preflight liveness
  yield. Failing-first channel and hosted-callback regressions reproduced the
  unwanted text transition before the correction. The shared pre-provider
  boundary now marks and logs liveness errors as control errors, and the
  channel runtime preserves that marker rather than selecting fallback.
- Focused round 12 proof passes 164 assistant-engine channel/outbox tests, 254
  hosted provider/callback tests, and 57 operator-config Linq HTTP tests. The
  production-shaped two-drain case proves the first drain makes no capability
  or message request and persists no fallback; the second sends the original
  `imessage_app` card under the same key. All three affected package typechecks
  and both documentation checks pass.
- Final ReviewGPT round 13 found post-claim route reselection. Two failing-first
  Web regressions reproduced participant `superseded` and thread target rewrite
  after the claimed route's home changed. Web now reads the existing delivery
  row before current-home projection, reauthorizes the frozen participant/line
  or thread, and fails closed on any mismatch. Route-level tests reach exact
  existing-claim handling rather than returning supersession or route mismatch;
  the hosted runtime test exact-replays the same participant effect and key
  when Web reports that provider entry already started.
- Round 13 correction proof passes 139 focused Web authority/routing tests, all
  3 opt-in PostgreSQL fallback lifecycle cases, and 254 hosted
  provider/callback tests. The claimed participant regression also changes the
  member's current assigned line and proves Web decrypts and reauthorizes the
  frozen claimed line rather than substituting the new home line. Prepared Web
  typecheck and both documentation checks pass.
- Final ReviewGPT round 14 found that the claimed participant recipient itself
  was still re-derived from mutable member identity. The requirement
  retrospective above rejects deletion of the only same-home recovery path and
  selects an encrypted recipient snapshot on the existing member-owned delivery
  row, with exact original-recipient replay after claim and fail-closed handling
  for incomplete legacy rows.
- The round 14 failing-first Web regression changed the member's verified phone
  after claim and reproduced `HOSTED_LINQ_PARTICIPANT_AUTHORITY_MISMATCH` instead
  of exact replay. The existing delivery row now atomically stores its member,
  blind recipient index, and row-bound encrypted recipient at participant claim;
  later route reads decrypt only that snapshot. Current-phone substitution,
  changed-line substitution, corrupt or incomplete legacy claims, and source or
  key mismatches all stop before provider entry with the existing structured
  unavailable/control diagnostics.
- Focused round 14 correction proof passes 162 Web engagement, deletion, and
  private-envelope tests; all 3 opt-in PostgreSQL fallback lifecycle cases; and
  254 hosted provider/callback tests. Prepared Web typecheck, Prisma client
  generation, migration application against the isolated PostgreSQL database,
  documentation gardening, diff whitespace, and private-field classification
  checks pass. Account deletion explicitly removes member-owned delivery rows,
  with the new foreign-key cascade as defense in depth.
