# Provider-start typing, held group drafts, and alert exclusion

Status: completed
Created: 2026-11-01
Updated: 2026-11-01
Completed: 2026-11-01

## Outcome and ownership

Direct conversations type when the model request fires. Only direct Linq media
requiring attachment evidence may type during import. Groups start typing only
when a finished message draft is held for sending. No-reply and reaction-only
drafts, non-held notifications, and scheduled turns stay silent. The Web first-contact
hint is unchanged. The parent owns review, commits, PRs, CI, and deployment;
this worktree remains uncommitted. This plan was rewritten at the user's request
when the founder replaced the previous design.

## Cause proof and implementation

Before the fix, `local-service.ts` called `startAssistantChannelTypingIndicator`
for every delivering turn after its shared plan and receipt, before executing the
provider or deciding `finalAction.kind === 'none'`. Reaction and edit wakes enter
that same path; group draft holding and reconsideration happen later. Mailbox
import also started Linq typing for text and attachments before an AI turn.

The shared helper returns `null` for canonical conversation scope `group` unless
the one held-reply call site opts in after the first provider result. Message
content means text, a response card, or media, with no `none` final action.
Reconsideration that drops the message stops typing before resume cleanup; a
retained message keeps the same handle. A quiet draft reconsidered into a reply
does not start typing immediately before sending. The existing hold and
reconsideration phase is a named local function; it preserves the turn-owned
input, session, and delivery bindings without growing the outer turn complexity.
Message and notification callers accept that result: input-observation and refresh
calls use optional chaining; stop returns immediately for null; delivery and
supersession depend on delivery outcomes, not on the indicator. The reassignable
turn handle is read live by admission, progress refresh, and final cleanup
closures. Late start records already accepted input IDs; later admissions use
the same handle. Hosted Linq preparation rejects inbound `threadIsDirect ===
false`; the turn dependency defers group policy to the engine. Low-level provider-effect
chat-action functions have no production typing-start caller; the only runtime
caller sends `typing_stop` during cleanup.

Direct message and notification typing starts through the existing
`onProviderRequestStarted` hook. `assistant-codex.ts` fires it synchronously at
the `turn/start` write, after thread start/resume and restore, before waiting for
acknowledgement. This preserves the provider-start failure barrier and adds no
parallel callback or telemetry wait. Receipt creation is back before typing
state initialization; receipt/setup failures no longer need indicator cleanup.
The first event creates or takes one handle and records all currently accepted
input IDs. Subsequent requests retain it; live-steered inputs use the existing
live binding. Media preparation remains owned across admission and setup until
that event takes the same provider session. The first-contact hint is unchanged.

Import uses `attachmentEvidenceRequired`, exactly the eligibility fact from
60a7b8826d, instead of the generalized text eligibility in 20edcf3606. It combines
attachment descriptors and projection eligibility already computed during staging.
Reaction and edit wakes contain text only. The existing preparation lifetime,
claim, cooldown, refresh, pending acceptance, and turn handoff remain intact;
there is no separate text preparation state or lazy/send-time start.

## Web ingress fact and ordering

Web stamps schema-versioned `orchestration.ingressConversationIsGroup` in
`hosted_ingress_latency_trace.phase_breakdown_json`. No migration or runtime
suppression milestone, callback, timestamp leaf, or special lock remains.

- Linq resolves webhook directness, durable group-route authority, and (when
  needed) canonical chat summary in `resolveHostedLinqPlanningEvent`. The planner
  derives the handoff fact from the wake directness; group-route wakes explicitly
  set directness false. Edits retain the original wake's directness.
- Telegram uses `summary.isDirect` both for wake `threadIsDirect` and the handoff
  fact. The HTTP routes pass their receipt timestamp through the service.
- Both signal-success and signal-failure paths carry the audience fact through
  the deferred webhook receipt write. One upsert records receipt and fact on
  `input.mailboxItemId`, without waiting for assistant-input binding or admission.
  The monitor requires a non-null receipt, so a lost deferred write cannot expose
  an unstamped trace. Conflict updates preserve the first audience fact and other
  phase data. Pending or failed telemetry never blocks the wake handoff.
- The typing query excludes only boolean true. Direct and unstamped traces retain
  the existing thresholds, conversation-activity cover, and missing-observation
  grace. Thresholds are strictly over 3 seconds warm and 8 seconds cold (including
  unknown warmth). Former 2,501/7,001 ms alert boundaries are non-alerting controls.
  All other cron monitors were checked; none treats absent typing as a
  failure, and none changed.

## Tests and changed expectations

New proofs cover group message/reaction/edit/coalesced inputs, both channels'
notifications, direct typing at provider start, quiet receipt/setup failures,
direct message/reaction/edit imports, held text/media drafts on both channels,
quiet/reaction-only drafts, reply-to-quiet and reply-to-reply reconsideration,
quiet-to-reply without a last-moment typing pulse, scheduled group silence,
deferred receipt/fact writes without blocking wake handoff,
Linq canonical correction, Telegram direct/group classification, and PostgreSQL
first-write/replay preservation and group exclusion without an assistant-input ID.
Slow direct, unstamped, and malformed-stamp controls still alert.

Existing expectations changed only for the final product rule:

- `typing indicators use the current audience route`: now group notification
  audiences return null without starting or refreshing typing.
- `typing indicator stop waits for underlying stop and blocks later refreshes`:
  direct fixture preserves the default lifecycle proof; groups require the explicit hold opt-in.
- `typing indicator stop does not wait for a pending start`: same direct-fixture reason.
- `typing indicator stop is bounded when the underlying stop stalls`: same direct-fixture reason.
- `sendAssistantMessageLocal completes a successful turn, persists usage, and stops typing indicators`:
  non-held group delivery and usage remain successful with no typing or stop.
- `sendAssistantMessageLocal live-steers same-conversation input without provider replay`:
  non-held joined group input produces no typing acceptance.
- `authenticated group preparation uses the existing auto-reply authority rule`:
  group preparation stays silent; the turn dependency permits an explicit engine request.
- The composed import text/audio matrix now distinguishes direct media handoff,
  direct text turn-owned start, and silent group import/admission behavior. The
  runtime fixture leaves the held-draft decision to the engine.
- The importer lifecycle matrix's text cases start and stop no preparation handle.
- `admitted typing survives import cancellation until turn handoff`: changed its
  fixture to media, the only remaining preparation-typing case.
- Direct accepted-input tests now assert typing has not started during receipt
  preparation and starts at the model request; initial and joined input IDs are
  batched at late start,
  including pending provider acceptance.
- Web exact handoff expectation includes directness; the SQL fixture accounts for
  the added JSON insert argument. Invalid phase parsing keeps the existing lenient
  behavior of dropping malformed phase data without rejecting the milestone.

Tests only exercising the superseded runtime suppression callback/milestone were
removed. The new Web fact replaces those assertions, not the mechanism itself.

## Verification commands

```sh
pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-local-service-typing-input.test.ts test/assistant-local-service-live-input.test.ts test/assistant-local-service-delivery.test.ts test/assistant-notification-turn-runtime.test.ts test/assistant-delivery-service.test.ts test/assistant-channels-runtime.test.ts
pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-notification-turn-runtime.test.ts
pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-runtime-config.test.ts --testNamePattern "starts cold and warm App Server turns before any lazy shared-data read"
pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-channel-activity.test.ts test/hosted-runtime-attachment-typing.test.ts test/hosted-runtime-typing-handoff.test.ts test/hosted-runtime-attachment-typing-composed.test.ts test/hosted-runtime-mailbox-conversation-import.test.ts
pnpm --dir packages/hosted-execution exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-control.test.ts
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/murph_test MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-runtime-typing-alert-postgres.test.ts
pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-onboarding-webhook-wake-direct-ensure.test.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/hosted-onboarding-linq-thread-route.test.ts apps/web/test/hosted-onboarding-telegram-dispatch.test.ts apps/web/test/hosted-runtime-latency-store.test.ts
pnpm --dir packages/assistant-engine typecheck
pnpm --dir packages/assistant-runtime typecheck
pnpm --dir packages/hosted-execution typecheck
pnpm --dir apps/web typecheck
pnpm complexity:diff
pnpm docs:drift
git diff --check
git diff HEAD --stat
```

Results: runtime/import 149 passed; hosted-execution 67 passed. After the deferred
receipt revision, all five Web files passed 539 tests and PostgreSQL passed 22. The six-file engine run had 320 passes and one new
notification-fixture failure (missing Linq delivery idempotency key). After fixing
the fixture, the full notification file passed all 110 tests; all 321 engine
cases are verified across those runs. Four typechecks, complexity, documentation
drift, and whitespace checks passed. The deferred receipt revision reran Web
typecheck, complexity, docs drift, and whitespace checks successfully. Its 16
handoff cases cover both channels, direct/group stamps, signal success/failure,
and pending/failed writes. An initial test assumed only one deferred task; the
corrected test also drains the existing direct-wake retention task.
The PostgreSQL proof uses local transaction-scoped fixtures. Initial failures
were new fixture assumptions corrected against the real contracts, not repository
friction. No new Frog entry was warranted.

## Held-draft refinement verification

The held-draft matrix adds 16 Linq/Telegram cases covering text and media,
no-reply and reaction-only drafts, reply-to-quiet immediate stop, reply-to-reply
single-session retention and progress refresh, and quiet-to-reply without a new
start. Two scheduled-group cases complement existing notification coverage.
Initial inputs and joined inputs both observe the late handle; delivery passes
`providerStop: false`, and discarded replies stop before resume cleanup.
The two runtime expectation updates are the group preparation/turn dependency
case (engine-requested starts are allowed) and composed import group admission
(the fake engine no longer requests typing at admission). No existing engine
expectation needed weakening: its silent cases are no-reply or non-held turns.

The first new engine run found six incorrect fixture expectations for a joined
input ID; the harness assigns `manual-1` after its `initial` input. Correcting
that expected ID preserves the live-binding assertion. The initial complexity
check rejected five added branches in the large turn function. Extracting the
existing held-draft phase reduced its complexity from 108 to 105 without changing
its state owner. Neither issue was repository friction.

Final refinement results: all six focused engine files passed (339 tests), and
all five runtime/import files passed (149 tests). The focused two-channel progress
refresh check also passed (2 tests). All four package typechecks, complexity diff,
docs drift, whitespace, and added-content privacy checks passed. The engine
suite was rerun after extracting the hold phase and strengthening the immediate
stop and progress-refresh assertions. Web/monitor behavior is unchanged from the
accepted deferred-receipt revision and was not rerun for this refinement.

## Limits and handoff

Telemetry remains best effort; receipt and audience fact land or are lost together.
Old unstamped traces with receipts retain ordinary alert behavior. No receipt
trace write is awaited on ingress. No live provider or production messages were
sent. Deterministic provider-boundary tests supply the Product UX proof; prompt/model behavior is unchanged. Parent review and exact-head CI remain.

Review the current refinement against HEAD `76e38a553e`. This revision neither
fetches nor copies newer origin/main content and leaves all edits uncommitted.

## Provider-start and threshold refinement

The parent committed the held-draft change as `76e38a553e`; this refinement is
uncommitted on that HEAD, with no fetch or branch movement. Group hold behavior
and Web ingress audience stamps remain unchanged. The engine mocks now emit the
existing provider-start event instead of implying it by returning a result.
Tests cover initial and pre-request joined telemetry, later live steering,
one session across repeated start events, receipt/setup/no-reply silence,
and preparation retention until delayed request start. The existing cold/warm
App Server wire test proves hook ordering after thread setup and at the request
write before acknowledgement.

PostgreSQL fixtures explicitly cover 2,999/3,000/3,001 and 7,999/8,000/8,001 ms
for both providers. Retained-cold workspace and rollout cases use the applicable
new slow boundary; Telegram reply-capped cases use 8,000/8,001 ms. Same-chat
silence-reset boundaries now measure exactly 3,000/8,000 ms, and exact-event
origin tests use 3,001 ms where a slow alert is the purpose. Unrelated 7,000 ms
waits and reply timestamps remain unchanged. Subjects, threshold details, and
unknown-warmth email copy are checked against 3,000/8,000 ms.

Current refinement verification: engine 342 passed; runtime/import 149 passed;
hosted-execution 67 passed; five Web webhook/store files 539 passed; PostgreSQL
monitor 22 passed; focused cold/warm App Server ordering test 1 passed (51
unrelated cases skipped). All four package typechecks, complexity diff,
documentation drift, whitespace, and added-content privacy checks passed.
The commands are listed above. No live provider or production calls were made.

During verification, an obsolete initial-admission typing call was removed
because the binding is necessarily null before provider start. New telemetry
expectations now include both `initial` and the earlier joined input in the
single late-start batch. Notification test doubles now emit the provider-start
hook; existing delivery/stop assertions remain intact. A PostgreSQL fixture's
3,000 ms silence was adjusted to 3,001 ms to preserve its slow-alert proof under
the new strict threshold. These were implementation/fixture corrections, not
repository friction; no Frog entry was needed.
