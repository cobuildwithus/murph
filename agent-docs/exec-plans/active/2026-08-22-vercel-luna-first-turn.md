# Vercel Luna first turn

## Goal

Answer an eligible instant-start iMessage first contact directly from Web with
a bounded tool-free Luna turn, then hand the completed exchange to the hosted
runtime so the next inbound uses the ordinary stateful runtime with correct
conversation context.

Success criteria:

- The fast response starts only after the existing first-contact classifier
  has durably allowed the exact event.
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
2. Add one bounded Web-owned Luna response request after exact admission. Use a
   narrow Murph first-turn prompt and a structured defer outcome for requests
   that need runtime capabilities.
3. On a reply outcome, preserve ordinary activation and same-line routing,
   send through the existing Linq delivery lifecycle, and atomically project
   provider acceptance into original-mailbox consumption plus one encrypted
   completed-turn handoff.
4. Wake the existing runtime with only the durable outbound pointer. The
   existing consumed-conversation importer restores the user and delivered
   assistant exchange in order with no reply obligation.
5. On defer, generation failure, or pre-accept provider failure, use the
   existing original-conversation signal and runtime reply path. On ambiguous
   provider outcome, reconcile the same delivery identity before choosing a
   fallback.
6. Prove success, fallback, replay, concurrent second inbound, causal import,
   no duplicate model/send, privacy, and usage accounting with focused tests.

## Verification

- Focused Web owner tests pass: 8 tests cover the strict Luna request, unsafe
  output deferral, accepted continuity, buffered failure, atomic rollback,
  encrypted-body replay, ambiguous send suppression, and definitive fallback.
- The full focused Linq dispatch file passes 206 tests, including parallel
  generation/prewarm, outbound-checkpoint wake, activation continuation, and
  ambiguous-delivery wake suppression.
- Existing assistant-runtime consumed-conversation tests pass 109 tests for
  context-only import, null reply targets, and a fresh conversation tail after
  that context.
- Web typecheck, changed-file ESLint, Prisma validation, and `git diff --check`
  pass. All 200 migrations applied to an isolated local database, and a
  transaction-rolled-back SQL probe proved the all-null/all-set constraint and
  member-deletion cascade.
- Provider capture with identical synthetic direct text and
  `gpt-tokenizer` 3.4.0 `o200k_harmony` measured the unchanged first classifier
  request at 339 tokens / 1,481 UTF-8 bytes at base and head. The new second,
  direct-only Luna request is 381 tokens / 1,634 bytes; group turns never enter
  this path. Temporary capture code and payloads were removed.
- Required exact-head PR CI and preliminary Product UX, prompt, and coverage
  specialist review, plus the cross-cutting final ReviewGPT gate.

## State

Active. Implementation and focused local proof are complete. The design reuses
the existing delivery ledger as the only provider outbox, stores the exact
pending body encrypted for ambiguous recovery, and represents the completed
exchange as two ordinary consumed conversation rows. Changelog packaging,
candidate review, exact-head gates, and completion remain.

## Working Set

- `apps/web/src/lib/hosted-onboarding/**`
- focused Web and existing assistant-runtime consumed-import tests
- hosted runtime, security, reliability, iMessage delivery, and package docs
- public changelog source when the behavior is member-visible
