# PR 567 Final Audit Remediation

## Goal

Close the four accepted exact-head ReviewGPT findings without adding another
phone-call authority or weakening the private-content boundary.

## Outcomes

1. The existing pointer-only Workflow is durable before Retell dispatch.
2. Any unresolved start or unsafe-storage cleanup authority blocks a different
   request at both the preflight and member-lock reservation boundaries.
3. Account deletion persists recovered provider identity before attempting an
   idempotent stop.
4. Start responses and assistant copy truthfully distinguish unresolved
   authority, accepted/placed calls, and unsuccessful call attempts.

## Constraints

- Keep `HostedPhoneCall` as the only durable authority.
- Do not retry a provider create while authority is ambiguous.
- Do not persist provider payloads, transcripts, recordings, or plaintext call
  content.
- Reuse the existing pointer Workflow and status contract; do not add a queue,
  scheduler, or second lifecycle.
- No helper agents or duplicate ReviewGPT runs.

## Working Set

- `apps/web/src/lib/phone-calls/**`
- `apps/web/test/phone-calls-*.test.ts`
- `packages/assistant-engine/src/assistant-codex/dynamic-tools.ts`
- `packages/assistant-engine/src/assistant/system-prompt.ts`
- focused assistant phone-call tests and owner docs

## Verification

- Focused web phone-call service, reconciliation, deletion, and workflow tests.
- Focused assistant phone-call and capability-prompt tests.
- Web and assistant-engine typechecks.
- Scoped diff, privacy, security, coverage, and parent final review.
- Push one corrected exact head, wait for required CI, then run at most one
  changed-head final ReviewGPT audit.

Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
