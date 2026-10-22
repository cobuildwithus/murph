# Compatible runtime readers for game negotiation and chat

Status: active
Created: 2026-10-22
Updated: 2026-10-22

## Goal

Prepare existing hosted runtimes to accept the upcoming game negotiation,
progress, and generated group kickoff contracts before Web starts producing
them. Preserve existing game requests and ordinary notification delivery.

## Ownership and evidence

The hosted-execution package owns strict transport schemas. Current parsers
reject the negotiating status and new progress fields after a successful Web
mutation. Assistant-engine owns generated notification execution and session
continuity; assistant-runtime owns its signed Web callback. Existing Web
delivery receipts remain the provider-effect owner.

This change widens those existing consumers and adds the narrowly scoped
bootstrap callback. It adds no game state, queue, migration, model tool, or
notification producer. Game negotiation and photo tool advertisement must wait
for their compatible Web implementations.

## Success criteria

- Both existing and expanded game response fixtures parse without dropping
  required fields; malformed authority and payload shapes remain rejected.
- A generated group kickoff uses the trusted callback once, preserves frozen
  provider recovery, and binds the returned real room to the existing session.
- The first reply resolves that session and sees the kickoff; unrelated rooms
  do not inherit its history.
- Existing ordinary notification behavior passes focused regression tests.
- Relevant typechecks, parent review, exact-head CI, and required final review
  complete before merge; deployment and warm runtime refresh precede writers.

## Scope and constraints

In scope: additive contracts, runtime/engine bootstrap consumer and focused
tests, deployment documentation. Out of scope: Web game writers, expanded model
tools, native UI, production messages. Use synthetic fixtures only. Preserve
all runtime-generation, delivery, and participant authority boundaries.

## Failure and rollout

Absent bootstrap metadata preserves ordinary delivery. Invalid or incomplete
metadata fails closed. The signed callback owns provider dispatch; a missing
Web callback cannot create a chat. No producer emits this contract until Web
and runtime consumers are deployed. After writers activate, do not roll back
to parsers that reject their responses. Refresh existing warm runtimes before
activating those writers and verify deployed revisions.

## Tasks

1. Collect compatible schema changes from negotiation and progress PRs.
2. Integrate the stable lifecycle runtime consumer subset without producers.
3. Review composed authority, replay, and first-reply continuity evidence.
4. Run focused verification, update the owning contract, and open the draft PR.
5. Complete parent review and required external review alongside CI.
6. Deploy compatible consumers and confirm convergence before writer rollout.

## Product UX

Internal preparatory rollout; it exposes no new user action. The protected
journeys are existing group proposals, ordinary notifications, and the first
reply after a generated kickoff. Feature PRs own the full native and chat UX.

## Verification

Run hosted-execution compatibility tests and typecheck, assistant-engine
notification/session tests and typecheck, assistant-runtime callback tests and
typecheck, scoped lint, complexity, and documentation drift checks. Reuse the
synthetic real-model kickoff/first-reply proof from the lifecycle implementation
when the extracted production code is identical; rerun if integration changes it.

## Progress

- Collected package-only consumers; no Web callback, producer, model-tool
  advertisement, or schema migration is included in this preparatory PR.
- Parent reviewed protocol compatibility, trusted callback admission, provider
  receipt replay, same-session binding, and source separation.
- 181 focused cases passed: 69 hosted-execution compatibility/parser cases,
  107 engine notification/session cases, and 5 runtime boundary cases.
- All three affected package typechecks passed. Complexity and documentation
  drift checks passed; existing notification runner complexity decreased.
- The identical extracted consumer code passed the producer branch's synthetic
  real-model kickoff and immediate-reply journey: one create, exact canonical
  dates, same session on replay, and no reminder writes after bare agreement.
- Remaining: draft PR, external review and CI, then the coordinated consumer
  deployment and warm-runtime refresh before feature writers activate.
