# Web-owned first turn

## Goal

Answer an eligible instant-start plain-text iMessage first contact directly from
Web with a bounded tool-free Murph turn, then hand the completed exchange to the hosted
runtime so the next inbound uses the ordinary stateful runtime with correct
conversation context.

Success criteria:

- Web durably claims the exact chat/event before generation; reply generation
  and the existing first-contact classifier then run in parallel.
- Web sends at most one answer for the exact first inbound through the existing
  Linq delivery and idempotency lifecycle.
- Provider acceptance records the ordinary self-authored Linq echo. The
  runtime imports that echo against its exact replied-to inbound, preserves the
  pair in the ordinary assistant transcript, and writes terminal suppression
  evidence before it can consider a competing reply.
- Temporal and Cloudflare receive pointers only; raw conversation content stays
  in the existing encrypted mailbox boundary.
- The completed-turn wake never invokes the runtime model or sends a second
  reply.
- The next inbound is causally ordered after the completed first turn and uses
  the ordinary hosted runtime.
- Generation, admission, activation, or definitive pre-acceptance provider
  failure leaves the original inbound available for the existing runtime path.
  Provider acceptance is the irreversible reply-ownership boundary even when
  later receipts report failure.
- Focused tests, typecheck, exact-head CI, specialist review, final ReviewGPT,
  and parent final review pass.

## Constraints

- Add no scheduler, queue, fallback service, or second durable delivery owner.
- Reuse the existing hosted mailbox, Linq delivery, activation, usage, wake,
  and runtime transcript owners.
- Keep the fast responder tool-free and first-contact-only. It must not claim
  account, health-data, scheduling, or other tool effects it cannot perform.
- Run the bounded reply model with high reasoning, the provider's standard
  service tier, and an 18-second hard deadline; retain the strict 600-character
  reply schema and fall back to the ordinary runtime when generation does not
  complete.
- Preserve the classifier as the admission authority; a speculative response
  may not be sent before exact model-source allowance, activation, current
  same-line routing, and access all succeed.
- Keep provider calls outside database transactions and preserve stable
  idempotency across ambiguous outcomes.
- Do not persist prompts, provider response bodies, model rationale, raw logs,
  or plaintext conversation content in control-plane rows.

## Product UX

This is a Product UX Feature. The primary person is a new direct-iMessage
contact whose first message is eligible for instant start: they should receive
a useful first answer without waiting for a cold hosted agent. The materially
different journeys are a simple conversational question, a request that needs
runtime tools or saved context, a fast-model failure, an ambiguous Linq send,
and a second message after provider acceptance but before background runtime
convergence. In every
case the person must see one coherent conversation, never duplicate or
contradictory first answers, and the next runtime turn must know exactly what
Web sent.

## Approach

1. Map the current classifier, instant-start activation, mailbox append, Linq
   runtime delivery, usage-accounting, and transcript-import seams and choose
   the smallest reuse path.
2. Claim one bounded Web-owned response obligation before generation, then run
   the classifier and tool-free model request in parallel. Use Murph's canonical
   package welcome for greetings/identity openers and a structured answer for
   every concrete plain-text request.
3. On a reply outcome, preserve ordinary activation and same-line routing,
   send through the existing Linq delivery lifecycle, and retain the accepted
   outbound in the ordinary conversation mailbox path.
4. When Linq echoes that accepted self-authored reply, the existing mailbox
   importer matches its reply reference to the exact pending inbound. Using
   the invocation's already-prepared assistant target, it appends the user and
   Web-authored assistant messages to the ordinary session transcript before
   writing terminal suppression evidence for the inbound.
5. On generation failure or pre-accept provider failure, use the existing
   original-conversation signal and runtime reply path. Once the provider
   accepts the Web send, persist that exact exchange as canonical context and
   never release a second runtime sender for the same inbound; later receipts
   remain delivery evidence, not reply-authority transitions.
6. Prove success, fallback, replay, concurrent second inbound, causal import,
   no duplicate model/send, privacy, and usage accounting with focused tests.

## Verification

- Six focused Web suites cover strict high-reasoning Murph output, canonical
  welcome, complete plain-text eligibility, durable pre-generation ownership,
  accepted continuity, exact-event runtime egress authority, centralized and
  confirmed fallback terminalization, failed-planning claim release, actual
  multipart cardinality, atomic rollback, encrypted-body replay, ambiguous send
  suppression, terminal exact replay, and definitive fallback. Webhook
  idempotency and Linq transport pass another 109 cases. A credential-gated
  seven-case real-model semantic matrix
  exercises greetings, capabilities, concrete health questions, missing
  personal context, requested actions, and urgent safety guidance without a
  live Linq destination.
- Deterministic owner-composed proof runs the actual Web claim, structured model
  request, Linq acceptance, exact outbound mailbox append, two-row consumption,
  and outbound checkpoint handoff. The runtime import proof then treats that
  consumed inbound/outbound pair as context and makes only the next distinct
  inbound replyable.
- The full focused Linq dispatch file passes 209 tests, including parallel
  generation/prewarm, outbound-checkpoint wake, activation continuation, and
  ambiguous-delivery wake suppression, exact-bound completeness, and full
  supported-text mailbox retention.
- Web typecheck, changed-file ESLint, Prisma validation, `git diff --check`, the
  expand-only migration guard, and the reviewed migration/schema snapshots
  pass. The payload migration now contains only nullable columns, its member
  foreign key, and its index.
- `pnpm test:diff` exits 0. Assistant Runtime passes 90 files and 2,479 tests;
  Web passes 788 files and 11,107 tests plus typecheck, lint with no errors, dev
  smoke, and production build; Cloudflare passes 156 files and 2,678 tests.
  Workspace boundaries and the provider, logging, crypto, and Temporal guards
  pass.
- The production request-shape test proves the high-reasoning, standard-tier,
  tool-free request with no explicit output-token budget or service-tier
  override and the strict welcome-or-answer schema; direct generation keeps one
  18-second hard deadline. The real-model matrix is intentionally opt-in and
  has no Linq call or destination.
- Public changelog fragment validation passes 7 tests, and the Web typecheck
  passes with source PR 2173 included.
- The round-11 correction passes 20 instant-turn, 149 delivery-store, 52
  runtime provider-entry, and 210 composed webhook cases together (431 total).
  These prove provider acceptance remains answered across buffered failure,
  exact replay, runtime entry, later webhook processing, and a rolled-back
  non-owner settlement without a receipt handoff or process-local cleanup
  owner. Web typecheck, focused ESLint, diff/privacy hygiene, and the matching
  reliability, security, and runtime-protocol readback pass.
- Required exact-head PR CI and preliminary Product UX, prompt, and coverage
  specialist review, plus the cross-cutting final ReviewGPT gate.
- The opt-in full local-stack E2E passes against an isolated PostgreSQL
  database, real Web admission and Luna requests, local Linq, Temporal,
  Cloudflare, the compiled runner/container bundle, and a deterministic runtime
  provider. It proves one canonical Web welcome, zero runtime model calls for
  that first inbound, exactly one runtime model call for the next inbound, both
  sides of the Web exchange in that request, and exactly two total Linq replies.

## State

Active. Standard-tier Luna generation and the full local-stack continuity proof
are implemented. The runtime reuses its mailbox importer, pending-input
terminal evidence, prepared assistant target, and transcript owner; no new
handoff store or process exists. Focused proof passes. Exact-head CI, the next
ReviewGPT round, and completion remain.

## ReviewGPT round 12 disposition

The finding was rejected. It proposed handling a direct Linq chat changing to
a group while retaining the same provider chat id. Linq's documented direct to
group transition creates a new chat, so the proposed same-id audience mutation
is not a supported provider transition. Adding another audience lifecycle for
that hypothetical state would add complexity without protecting a reachable
path. Existing route and audience checks still apply to every actual inbound.

## ReviewGPT round 11 disposition

The finding was accepted. A transient rollback while settling a speculative
claim could persist the admission decision but leave the delivery row attempted.
Exact replay reused that decision without recreating the generation promise, so
the process-local cleanup predicate skipped durable settlement and could
acknowledge signup or another path while the orphaned row fenced later messages.

Cleanup now derives only from durable exact-event identity. Under the existing
chat lock, abandonment first reads the event-derived delivery row, returns when
none exists, and otherwise uses the existing skip terminal plus final-state
verification. Planner failure and every completed non-instant plan invoke that
owner regardless of whether the current request started generation. The replay
test injects the first settlement rollback and proves the second handler settles
before alternate egress without rerunning admission or reply generation. This
adds no field, enum, queue, timer, service, lease, state machine, or recovery
process.

## ReviewGPT round 10 retrospective

The findings were accepted. A terminal delivery receipt is not a total or
monotonic ownership boundary: it may never arrive, a failed receipt may later be
superseded by delivery evidence, and clearing the encrypted handoff before a
runtime wake makes that transfer non-replayable when signaling fails. The
round-9 correction therefore introduced indefinite silence, a duplicate-reply
race, and destructive handoff settlement.

The requirement decision is to preserve the requested Web fast path without
adding a timer, queue, scheduler, lease, receipt state machine, or reconciliation
owner. Linq provider acceptance is the one total irreversible boundary. Before
acceptance, a definitive failure may release the existing runtime fallback.
After acceptance, Web remains the sole sender, the accepted outbound is
canonical attempt history, and later receipts are delivery evidence only; they
never authorize a second answer. A rare downstream provider failure may end in
an explicit delivery failure rather than a competing runtime reply. This is the
smallest architecture that preserves immediate Web sending and exactly one
provider-visible response.

The implementation deletes the complete round-9 receipt-finalization delta and
returns to the round-8 shared-ledger rule. It adds no new state or owner.

## ReviewGPT round 9 retrospective

Round 9 correctly found that Linq HTTP acceptance is not handset-delivery proof:
recording it as a response the member certainly saw could produce false history
when a later failure arrives. The receipt-boundary remediation was accepted and
implemented, but round 10 disproved its key premise that terminal receipts are
complete and irreversible.

The round-10 requirement decision supersedes that tactical correction. The
system now treats provider acceptance as durable send ownership, not guaranteed
handset observation, and records later delivery outcomes without transferring
the inbound to another sender.

## ReviewGPT round 8 retrospective

The finding was accepted. The round-7 correction let a buffered failed receipt
cede an already provider-accepted Web send to the runtime. A later delivered
receipt could then reverse ownership again, allowing two independently
idempotent replies or leaving a delivered Web response outside canonical
mailbox history.

The irreversible boundary is provider acceptance. Before acceptance, a
definitive failure may release the existing runtime fallback. After acceptance,
Web remains the sole owner and atomically records the exact outbound plus the
consumed inbound even when a buffered receipt currently says failed. Later
receipts update delivery evidence but cannot authorize or suppress a second
sender. This deletes the post-acceptance cession branch and reduces both exact
replay and runtime egress to one existing-ledger rule: provider correlation is
answered; only an uncorrelated terminal row is fallback. No field, enum, queue,
service, state owner, dependency, lease, or reconciliation process is added.

## ReviewGPT round 7 disposition

The finding was accepted. Linq can report a buffered terminal failure while
Web records provider acceptance. The finalizer cleared the encrypted body and
correctly returned to ordinary-runtime fallback, but the accepted timestamp,
message lookup key, and receipt still made both exact replay and runtime egress
classify the row as already answered. That silenced both owners.

The same failed-delivery update now records explicit fallback cession on the
existing ledger row. One private pure disposition function orders the evidence
for both consumers: delivered evidence wins, then explicit cession, then other
provider correlation, then definitive uncorrelated failure. This preserves a
late failure after completed continuity as already answered while letting a
buffered failure reach the ordinary runtime. Focused tests compose the real
runtime and exact-replay owners over all three order-sensitive states. No new
field, enum, owner, queue, service, dependency, lease, or recovery process was
added.

## ReviewGPT round 7 cap retrospective

The original requirement remains one low-latency Web reply for an eligible
first plain-text iMessage, with the ordinary runtime owning every fallback and
later turn. The first-reviewed head had 1,065 added and 3 deleted authored
source lines. The round-7 corrected working patch has 1,703 added and 26
deleted authored source lines: review remediation increased source additions by
638 (60%) while total source churn remains 1,729 lines. The growth came from
making the existing delivery-ledger lifecycle explicit at already-required
boundaries: pre-generation ownership, terminal release, encrypted exact-body
replay, route revalidation, runtime egress authority, and outbox
supersession. The repeated mechanism was incomplete ordering of states already
owned by that ledger, not proliferation of independent machinery.

Deletion, splitting, or a new coordinator would either remove the latency
outcome or duplicate delivery authority. The corrected shape has one ledger,
one chat lock, one route authority, one provider idempotency key, and one shared
disposition rule. The recommended cap decision is therefore one explicit
continuation round to obtain a resolved result on this exact simplified shape;
that decision remains pending user authorization after the required local,
parent, CI, and preliminary-gate confirmations.

## ReviewGPT round 5 disposition

Both round 5 findings were accepted. First, request-local activation-wake
suppression could not protect the independent runtime Linq sender. The existing
egress assertion now carries the already validated inbound event id to the
chat-locked provider-entry transaction. That transaction resolves the exact
`instant_first_turn_v1` row immediately before the runtime provider fence:
unresolved ownership defers, accepted or delivered evidence ends the stale
runtime send as already answered, and only an absent or terminal fallback row
allows runtime dispatch. A definite route-read or projection failure after
generation must also confirm the existing attempted row was skipped before
fallback; an unconfirmed skip retains Web ownership and suppresses the wake.

Second, the reply model reused the classifier's silent 2,000-character prefix
as if it were the complete message. The existing normalization boundary now
reports one transient completeness bit. Classification keeps the same bounded
input, but Web reply eligibility requires a complete normalized value, so a
longer supported one-part message follows the ordinary runtime path with its
full mailbox text. These corrections add no persisted field, API, owner, queue,
service, dependency, lease, or reconciliation loop.

## ReviewGPT round 6 disposition

The finding was accepted. The exact already-answered egress result prevented a
second provider send, but the stale runtime outbox intent was still recorded as
a terminal delivery failure. That false failure could stage a system input and
wake another assistant pass. The existing outbox authority-supersession branch
now also owns this Linq result: it preserves the exact diagnostic code, marks
the stale intent terminal without retry, and produces no failure input or
recovery wake. This reuses the current outbox state machine and adds no state,
owner, queue, service, dependency, or special recovery path.

## ReviewGPT round 4 disposition

The round 4 finding was accepted. A retryable enrollment or planner exception
could escape after Web claimed and generated an answer but before provider
dispatch persisted that body. The attempted row could not resume, yet it fenced
later conversation work and could eventually be reclaimed after the ordinary
runtime had answered.

The planner catch now invokes the existing skip writer before rethrowing. That
writer changes only an attempted pre-provider row, so provider-started,
failed-with-payload, and completed delivery obligations remain untouched. The
focused retryable-enrollment test proves generation precedes this terminal
release. No new state, owner, lease, queue, service, or dependency is added.

## ReviewGPT round 3 disposition

Both round 3 findings were accepted. First, admission metadata deduplicated part
types, so two source text parts looked like one plain-text message after their
content was joined and bounded. The request now preserves each source part type
in order; the existing one-part eligibility check therefore measures actual
cardinality with no new field or parser.

Second, the shared delivery claimant intentionally reopens terminal rows for
signup and notice retries, but that generic policy also reopened a skipped or
definitively failed instant first turn on exact webhook replay. The existing
ledger now returns one template-specific terminal outcome when the instant row
is skipped or failed with no payload schema. A failed row whose exact encrypted
reply remains retained still follows the existing reclaim-and-resume path. Web
maps the terminal outcome to ordinary-runtime fallback before model generation
or provider entry. Other templates keep their existing behavior. This adds no
queue, service, state owner, dependency, lifecycle enum, or reconciliation
process.

## ReviewGPT round 2 retrospective

ReviewGPT round 2 required a retrospective because the first remediation moved
durable ownership before generation but did not terminate that speculative
claim when the completed planner selected signup or another non-instant path.
The new chat fence could therefore turn a supported fallback into a permanent
block for later messages.

The original requirement still needs the classifier and reply generation to
overlap, while generation must not begin without restart-safe ownership. The
claim therefore remains speculative in the existing delivery ledger. The
smallest correction is one planner-convergence decision: an exact
model-approved active direct wake continues the Web reply, and every other
successfully planned outcome marks the same claim skipped before any fallback
side effect. A caught planner failure also skips an attempted claim because its
generated body has not reached the provider-payload boundary; ambiguous and
completed obligations remain final to that writer. This central rule replaces
the model-block-only cleanup and adds no
owner, state, queue, scheduler, service, dependency, lease, or reconciliation
loop.

From the first-reviewed head to the round 2 head, review remediation added the
existing-ledger preclaim, chat and route fencing, encrypted exact-body retry,
canonical Murph welcome ownership, plain-text eligibility, and focused proof.
Authored-source additions rose from 1,065 to 1,441, an increase of 376, below
the repository's 500-line remediation trigger. The correction shrinks the
ownership decision to one terminal branch and prove model block, classifier
unavailability, non-retryable enrollment failure, alternate-line/signup
fallback, successful Web dispatch, ambiguous delivery, exact retry, later
direct inbound, and group transition without adding lifecycle machinery.

## Working Set

- `apps/web/src/lib/hosted-onboarding/**`
- focused Web and existing assistant-runtime consumed-import tests
- hosted runtime, security, reliability, iMessage delivery, and package docs
- public changelog source when the behavior is member-visible
