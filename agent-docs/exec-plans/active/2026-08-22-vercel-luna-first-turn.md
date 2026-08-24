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
- Provider acceptance consumes the original conversation mailbox item and
  durably hands the exact delivered assistant text to the runtime as an
  already-completed turn.
- Temporal and Cloudflare receive pointers only; raw conversation content stays
  in the existing encrypted mailbox boundary.
- The completed-turn wake never invokes the runtime model or sends a second
  reply.
- The next inbound is causally ordered after the completed first turn and uses
  the ordinary hosted runtime.
- Generation, admission, activation, or provider failure leaves the original
  inbound available for the existing runtime path.
- Focused tests, typecheck, exact-head CI, specialist review, final ReviewGPT,
  and parent final review pass.

## Constraints

- Add no scheduler, queue, fallback service, or second durable delivery owner.
- Reuse the existing hosted mailbox, Linq delivery, activation, usage, wake,
  and runtime transcript owners.
- Keep the fast responder tool-free and first-contact-only. It must not claim
  account, health-data, scheduling, or other tool effects it cannot perform.
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
was delivered.

## Approach

1. Map the current classifier, instant-start activation, mailbox append, Linq
   runtime delivery, usage-accounting, and transcript-import seams and choose
   the smallest reuse path.
2. Claim one bounded Web-owned response obligation before generation, then run
   the classifier and tool-free model request in parallel. Use Murph's canonical
   package welcome for greetings/identity openers and a structured answer for
   every concrete plain-text request.
3. On a reply outcome, preserve ordinary activation and same-line routing,
   send through the existing Linq delivery lifecycle, and atomically project
   provider acceptance into original-mailbox consumption plus one encrypted
   completed-turn handoff.
4. Wake the existing runtime with only the durable outbound pointer. The
   existing consumed-conversation importer restores the user and delivered
   assistant exchange in order with no reply obligation.
5. On generation failure or pre-accept provider failure, use the
   existing original-conversation signal and runtime reply path. On ambiguous
   provider outcome, reconcile the same delivery identity before choosing a
   fallback.
6. Prove success, fallback, replay, concurrent second inbound, causal import,
   no duplicate model/send, privacy, and usage accounting with focused tests.

## Verification

- Focused Web owner tests pass 360 cases covering strict Murph output, canonical welcome,
  plain-text eligibility, durable pre-generation ownership, accepted continuity,
  centralized fallback terminalization, retry-preserving enrollment failure,
  actual multipart cardinality, atomic rollback, encrypted-body replay,
  ambiguous send suppression, terminal exact replay, and definitive fallback.
  Webhook idempotency and Linq transport pass another 109
  cases. A credential-gated seven-case real-model semantic matrix
  exercises greetings, capabilities, concrete health questions, missing
  personal context, requested actions, and urgent safety guidance without a
  live Linq destination.
- The full focused Linq dispatch file passes 206 tests, including parallel
  generation/prewarm, outbound-checkpoint wake, activation continuation, and
  ambiguous-delivery wake suppression.
- Delivery-store tests pass 140 cases, including exact attempted-to-provider
  advancement, terminal skipped/definitive fallback, encrypted ambiguous
  recovery, and conflicting chat ownership; webhook idempotency and Linq
  transport pass 109 cases.
- Web typecheck, changed-file ESLint, Prisma validation, `git diff --check`, the
  expand-only migration guard, and the reviewed migration/schema snapshots
  pass. The payload migration now contains only nullable columns, its member
  foreign key, and its index.
- `pnpm test:diff` exits 0. Its Web lane passes 850 files and 11,031 tests,
  changed-app typecheck, lint with no errors, dev smoke, and production build.
  The workspace boundary step still reports two unrelated pre-existing Junction
  test-import diagnostics outside this PR.
- The production prompt test proves the fixed tool-free request and strict
  welcome-or-answer schema. The real-model matrix is intentionally opt-in and
  skipped locally because no provider credential is configured; it has no Linq
  call or destination.
- Public changelog fragment validation passes 7 tests, and the Web typecheck
  passes with source PR 2173 included.
- Required exact-head PR CI and preliminary Product UX, prompt, and coverage
  specialist review, plus the cross-cutting final ReviewGPT gate.

## State

Active. The round 2 correction, focused local proof, and changelog packaging are complete. The design reuses
the existing delivery ledger as the only provider outbox, stores the exact
pending body encrypted for ambiguous recovery, and represents the completed
exchange as two ordinary consumed conversation rows. Candidate review,
exact-head gates, and completion remain.

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
side effect. Retryable planner failures retain the claim for exact-event
recovery. This central rule replaces the model-block-only cleanup and adds no
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
