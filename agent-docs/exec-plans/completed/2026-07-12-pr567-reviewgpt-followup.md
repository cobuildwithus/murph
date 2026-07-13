# PR 567 ReviewGPT Authority Follow-up

## Goal

Resolve the accepted ReviewGPT findings for PR 567 without weakening the
hosted phone-call privacy boundary or adding a second call-creation owner.

## Accepted Outcomes

1. Provider responses after Retell create dispatch remain ambiguous unless
   durable provider identity proves the effect.
2. A known provider call id remains persisted cleanup authority even after a
   successful compensating stop, and every provider wait honors the caller's
   aggregate abort signal.
3. `ask_murph` accepts an omitted storage field only for a previously bound,
   live call whose durable row already proves safe creation; explicit unsafe
   storage and unbound callbacks still fail before private-content decrypt.
4. Exact request-key replays read and validate the existing durable effect
   before running prerequisites needed only for a new call.
5. Foreground account-deletion cleanup processes a deterministic bounded batch
   under one aggregate deadline, leaving durable rows for retry when work
   remains.
6. A pointer-only web Workflow durably reconciles ambiguous starts, while the
   assistant reports `starting` and `failed` authority as unsuccessful tool
   results instead of claiming a call was placed.

## Constraints

- Keep `HostedPhoneCall` as the sole durable phone-call authority.
- Never issue a second provider create while the first effect is ambiguous.
- Do not persist raw Retell payloads, transcripts, recordings, or private call
  content outside the existing encrypted fields.
- Use the existing web Workflow primitive for the pointer-only continuation;
  do not add a scheduler, queue, or hosted-runtime orchestration protocol.
- Do not interrupt already-running ReviewGPT sessions.

## Working Set

- `apps/web/src/lib/phone-calls/**`
- `apps/web/app/api/retell/functions/ask-murph/route.ts`
- focused `apps/web/test/phone-calls-*.test.ts`
- `packages/assistant-engine` phone-call tool status handling and focused test
- phone-call owner docs if the runtime contract changes materially

## Verification Plan

- Focused hosted phone-call Vitest suites, including provider ambiguity,
  consultation storage variants, replay ordering, and bounded deletion.
- Hosted web typecheck.
- Scoped diff verification and privacy review.
- Parent final review; local helper agents remain disabled by controller policy.
- Push the scoped commit, wait for exact-head CI, then run one final ReviewGPT
  audit on the changed exact head.
Status: completed
Updated: 2026-07-12
Completed: 2026-07-12
