# Send approved vault files through the foreground conversation

Status: completed
Created: 2026-07-21
Updated: 2026-07-21

## Goal

- Restore the approval-page confirmation message so the member can return to
  the originating conversation and let Murph send an already-approved file in
  the next foreground turn, without foreground chat starving that exact causal
  continuation.

## Success criteria

- Approving a secure action returns to the preferred Murph conversation with
  `I approved the secure request.` prefilled.
- Revisiting an approved action preserves the same prefilled return message.
- The exact causal approval wake finishes its bounded outbox delivery before a
  simultaneously pending foreground reply; unrelated maintenance still yields.
- The durable approval-outcome wake remains in place as the automatic fallback;
  this change adds no queue, flag, scheduler, polling loop, or approval state.
- Denied and expired actions keep their existing safe terminal behavior.
- Focused Web tests, routed diff verification, required completion reviews,
  PR CI, and ReviewGPT pass on the exact pushed head.

## Scope

- In scope: the action-approval decision response, terminal approval page, the
  existing causal approval-continuation ordering, focused tests, and the hosted
  sensitive-action approval flow documentation.
- Out of scope: the runtime mailbox scheduler, approval persistence schema,
  delivery retry ownership, denial copy, broad background-maintenance priority,
  and unrelated messaging behavior.

## Constraints

- The authenticated approval decision remains the only authorization evidence;
  the prefilled message is a foreground continuation hint, not authority.
- Preserve the automatic system-mailbox wake as a durable fallback when the
  member does not send the prefilled message or contact resolution is missing.
- Keep the confirmation short, reciprocal, first-party, and limited to the
  existing Murph conversation.

## Risks and mitigations

1. Risk: treating the confirmation message as authorization could weaken the
   approval boundary.
   Mitigation: retain the existing consume-time approval recheck and document
   the message as a latency path only.
2. Risk: denial could accidentally invite an unnecessary reply.
   Mitigation: add the prefilled text only for approved decisions and approved
   terminal revisits; leave denied behavior unchanged.
3. Risk: Web and the hosted runtime deploy at different times.
   Mitigation: the confirmation path uses the existing approved-file tool and
   the existing automatic wake remains backward-compatible throughout rollout.

## Tasks

1. Restore the approved confirmation body in the decision redirect and terminal
   approved-page redirect.
2. Add focused regression tests for approval, denial, contact failure, and
   approved revisits.
3. Update the durable approval-flow documentation.
4. Let the existing exact causal approval wake finish its bounded delivery
   before a simultaneously pending foreground assistant turn.
5. Run routed verification, required audits, final review, commit, PR, CI, and
   ReviewGPT.

## Verification

- `pnpm test:diff apps/web/app/api/action-approvals/[approvalId]/decision/route.ts apps/web/app/approve/[approvalId]/page.tsx apps/web/test/action-approval-decision-route.test.ts apps/web/test/action-approval-page.test.tsx packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts`
- Direct scenario proof that an approved decision returns an SMS/iMessage link
  containing the encoded confirmation body while a denied decision stays bare.
- Focused runtime proof that the exact pending-effects reconciliation wake
  drains the approved delivery in one pass despite foreground work being
  pending, while unrelated background work retains foreground priority.
- `pnpm verify:acceptance`
- Required `frontend-review` and `coverage-write` passes, parent final review,
  PR CI, and exact-head ReviewGPT.

## Completion evidence

- `pnpm verify:acceptance` passed, including full workspace typechecks and
  guards, package coverage, Web verification and production build, and
  Cloudflare verification.
- The earlier routed `pnpm test:diff ...` pass completed the affected runtime
  and Web typechecks/tests but its first production build attempt could not
  fetch the existing Google fonts; the final acceptance build retried and
  passed.
- Direct return-link proof passed against the real contact-routing helper for
  `I approved the secure request.` URL encoding.
- `frontend-review` and `coverage-write` returned no actionable findings and
  made no edits. The Fable UI double-check was attempted and reported explicit
  credit exhaustion, so the completed Codex frontend review is the documented
  substitute.
- Parent final review confirmed that the exact causal effect remains bounded by
  its effect ID and consume-time approval check, foreground input remains
  pending for the next pass, and unrelated maintenance still yields.
Completed: 2026-07-21
