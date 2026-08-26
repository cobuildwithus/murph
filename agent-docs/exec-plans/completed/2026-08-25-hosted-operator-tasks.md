# Durable hosted operator tasks

Status: completed
Created: 2026-08-25
Updated: 2026-08-25

## Goal

- Give allowlisted hosted operators one simple, durable way to ask a specific
  member's Murph for a private diagnostic or one direct member message, while
  reusing the existing mailbox, runtime wake, read-only assistant, transcript,
  and outbox owners.

## Success criteria

- `/ops` exposes one focused operator-task entry point with member lookup,
  diagnostic/message choice, bounded prompt entry, status, and private results.
- One reusable Web-owned admission function can be called by the Ops route now
  and by an existing workflow or cron later without going through the UI.
- Requests and diagnostic results remain in encrypted mailbox/private fields,
  never enter logs, and
  remain bound to the target member and admitting operator.
- Diagnostic tasks run through the existing detached read-only personal-context
  lane and never send a member message.
- Message tasks produce at most one model-authored direct message through the
  existing notification, transcript, outbox, route-authority, and line-health
  path; the operator prompt is not written to member-visible history.
- Focused owner tests, typechecks, Product UX walkthrough, required ReviewGPT
  passes, exact-head CI, and a draft PR complete successfully.

## Scope

- In scope: one member at a time; active private-direct Linq or Telegram routes;
  diagnostic and member-message tasks; durable task status/result; route/API/UI;
  runtime completion callback; owner documentation.
- Out of scope: groups, bulk operations, first contact, schedules or templates,
  media, email, arbitrary runtime writes, multiple messages, provider receipt
  dashboards, and a new queue or scheduler.

## Constraints

- Technical constraints: Web owns canonical task state and authorization; the
  encrypted system mailbox owns runtime work; existing Temporal signaling is a
  payload-free wake only; existing runtime/outbox owners remain authoritative;
  no provider or network call occurs inside a database transaction.
- Product/process constraints: member-facing copy must never imply the member
  requested the task; operator text and private evidence stay out of durable
  public artifacts; the UI reuses existing design-system components and has a
  repository-owned design study.

## Risks and mitigations

1. Risk: an old or canceled task sends into a changed conversation.
   Mitigation: bind the admitted direct route and revalidate task, member,
   operator, expiry, cancellation, and current route immediately before the
   irreversible outbox commit.
2. Risk: an operator diagnostic gains mutation or delivery authority.
   Mitigation: execute it only through the existing detached read-only ask lane
   and return its result through the signed control callback.
3. Risk: a new abstraction duplicates scheduling or message delivery.
   Mitigation: expose one admission function and reuse mailbox plus the normal
   notification/outbox pipeline; future workflow/cron callers supply an
   idempotency key and call the same function.
4. Risk: private prompts/results leak through logs, UI, or review artifacts.
   Mitigation: keep prompts only in the existing encrypted mailbox, encrypt
   diagnostic results with member-bound control-domain crypto, log metadata
   only, and use synthetic fixtures and screenshots.

## Tasks

1. Trace and lock the existing mailbox, detached-ask, notification, route,
   crypto, and Ops access boundaries.
2. Add the minimal shared contracts, persisted task owner, migration, admission
   API, status/cancel reads, and signed runtime completion boundary.
3. Add runtime execution for diagnostic and member-message tasks by composing
   the existing read-only ask and notification/outbox owners.
4. Add the Ops page and design study using existing components.
5. Add focused contract, Web, Cloudflare, runtime, engine, route, and component
   tests plus owner-document updates.
6. Run focused verification and the Product UX walkthrough, inspect the diff,
   commit/push, run required preliminary and final ReviewGPT gates with CI,
   resolve accepted findings, and prepare the draft PR for merge admission.

## Decisions

- One `HostedOperatorTask` row is the only new canonical state owner.
- Its stable idempotency key is bound to a persisted digest of the normalized
  task request, so a retry can only replay the same intent.
- One task kind carries both diagnostic and member-message work; behavior stays
  closed and explicit rather than becoming an arbitrary command runner.
- The Web admission function is the durable reusable primitive. UI, workflow,
  and future cron callers do not receive separate execution paths.
- Member messages use an explicit output-only prompt profile and Web task
  authorization at the existing provider and pre-delivery hooks; completion
  means one intent entered normal messaging, not provider delivery.
- Delivery disclosure is prompt semantics, not a Web-authored fixed prefix or
  a draft round trip.

## Verification

- Commands to run: focused Vitest suites for every touched owner, Prisma
  validation/generation and migration checks, Web and affected package
  typechecks, scenario-integrity if routed by the testing map, browser proof for
  desktop/mobile Ops states, exact-head required CI, and required ReviewGPT.
- Expected outcomes: exact replay admits one task/mailbox identity, canceled or
  stale work cannot send, diagnostics return privately without delivery,
  message work queues one normal direct delivery, and unrelated foreground
  conversation behavior remains unchanged.
Completed: 2026-08-25
