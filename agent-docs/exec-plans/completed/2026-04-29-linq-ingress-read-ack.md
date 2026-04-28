# Linq Ingress Read Ack

## Goal

Make hosted Linq/iMessage read acknowledgements happen promptly after webhook ingress persists the conversation mailbox row, and remove the web-owned ingress typing diagnostic so typing remains owned by the hosted runner/container.

## Constraints

- Keep `apps/web` as the provider ingress owner for immediate provider-visible acknowledgements.
- Do not change canonical mailbox ordering, hosted workspace checkpointing, or assistant reply semantics.
- Leave the assistant-runtime/container typing path untouched.
- Preserve the assistant-runtime read acknowledgement for now as a best-effort fallback unless follow-up review explicitly removes it.
- Do not log raw phone numbers, chat ids, message ids, request bodies, API keys, or provider headers.
- Keep unrelated dirty work untouched.

## Plan

1. Replace the hosted-web ingress typing helper with a small Linq read-ack client helper.
2. Extend active-member Linq webhook planning with an optional read-ack chat marker.
3. Call the read ack after the DB transaction and before hosted runner handoff, with privacy-bounded timing logs.
4. Remove the hosted-web ingress typing diagnostic env/config/docs and local E2E opt-in.
5. Add focused hosted-web tests for success, failure swallowing/logging, ignored/self cases, and no ack before persistence.
6. Run focused tests/typecheck and required audits for the touched surfaces.

## Verification

- `pnpm --dir apps/web test -- --runInBand test/hosted-onboarding-linq-dispatch.test.ts test/hosted-onboarding-linq-http.test.ts test/hosted-onboarding-env.test.ts test/hosted-onboarding-runtime.test.ts test/hosted-onboarding-csrf.test.ts` passed.
- `pnpm --dir apps/web typecheck` passed.
- `pnpm --dir apps/cloudflare test -- --runInBand test/hosted-local-linq-webhook-e2e.test.ts` passed.
- Scoped `git diff --check` passed.
- Required coverage, security/privacy, and task-finish reviews completed; the coverage finding was addressed with the mailbox-persistence-failure regression.
Status: completed
Updated: 2026-04-29
Completed: 2026-04-29
