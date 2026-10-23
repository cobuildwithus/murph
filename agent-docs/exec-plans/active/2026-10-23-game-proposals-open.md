# Keep game change proposals open

Status: active
Created: 2026-10-23
Updated: 2026-10-23

## Outcome and invariant

Pending changes survive day boundaries. Approval applies only to days neither player has started; historical schedules, entries and scores remain intact. Decline, proposer cancellation, terms replacement and game completion retain their existing authority.

## Owner and evidence

`changes.ts` expires proposals on their stored effective day and `service.ts` uses that stale day for new terms. Remove time expiry, derive the application boundary under the game lock, and retain canonical pending JSON and event history. Reuse the existing lifecycle delivery receipt, mailbox and dispatch authority for refusals. No new dependencies or schema.

## Product UX

- Outcome: delayed agreement remains possible without silently losing a request.
- Entry and promise: app pending pill/detail and group approval describe the next unstarted day at acceptance.
- People: proposer, partner, differing time zones, pre-start date changes, elapsed shortening, declined/cancelled requests, replaced terms and ended games.
- Proof: pure rules, PostgreSQL writes/readback/history, view projection, lifecycle queue and dispatch tests, focused synthetic real-model notice.
- Done when: preserved past obligations, one refusal notice in an existing room, truthful pending day, and reviewed production deployment.

## Implementation and verification

1. Change expiry and accept-time rules; persist refused resolution before returning the plain error.
2. Extend the lifecycle notice path with immutable refusal evidence and exact audience checks.
3. Project pending effective day at read time; document iOS wording and durable contract.
4. Run focused unit/Postgres/view/lifecycle tests, typecheck and lint; complexity, logs and docs guards.
5. Parent review, requested read-only Codex deep review, scoped commit/PR, ReviewGPT eragon concurrently with CI.
6. Close plan with finish-task, merge after gates, verify exact-SHA admission and production health; runtime verification if required by changed consumer behavior.

## Failure and rollout

Resolution and notice reservation share the existing short transaction. Existing delivery keys deduplicate retries. No provider work enters the game lock. New notices use the current generic notification envelope; check runtime key admission before rollout. Fix forward only. No shared QA stack changes.

## Progress

- Root cause confirmed; implementation complete with no schema or dependency changes.
- Rules/view/lifecycle suites and PostgreSQL approval, history, scoring, refusal, cancellation, negotiation and funding proofs pass. Provider dispatch engagement proof passes.
- Web, hosted-execution and assistant-engine typechecks pass; Web lint passes with pre-existing warnings. Complexity guard passes with no new debt; its existing unrelated runtime-control hotspot is unchanged. Logs guard and docs drift pass.
- Two production-builder real-Codex journeys (gpt-6.1-sol, local subscription) each queue one concise refusal line and no tool actions. Parent reply review: Ready.
- Reset-to-default start date remains calculated at acceptance, unlike a fixed proposed date.
- Requested read-only gpt-6-astra deep review completed: one accepted fixed-date negotiation cutoff finding, corrected by retaining the validated explicit date; composed PostgreSQL regression added. PR/ReviewGPT/CI/release pending; external status file owns release evidence.
