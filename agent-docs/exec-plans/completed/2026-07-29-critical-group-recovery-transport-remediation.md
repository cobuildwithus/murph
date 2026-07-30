# Critical group recovery transport remediation

Goal (incl. success criteria):
- Reconcile the ReviewGPT implementation patch with the already-verified
  critical-line recovery PR.
- Move backup-line selection and final authority checks to the provider
  transport transaction so a delayed side effect cannot send after member,
  assignment, participant, incoming-line, or backup-line state changes.
- Make recovery converge once per member, failed incoming line, and group
  thread while preserving the current-day capacity correction.

Constraints/Assumptions:
- Preserve the existing canonical route, line-capacity, delivery-idempotency,
  and provider-dispatch owners.
- Keep exact assigned-line `AT_RISK` group admission on the ordinary route.
- Never send from a hard-blocked line or mutate group participants.
- Add no schema, queue, cron, manager, transfer state, or new retry lifecycle.
- Keep raw participant contacts, phone numbers, group identifiers, and provider
  prose out of durable failure text, logs, plans, and public artifacts.
- Preserve the verified wall-clock UTC capacity-day behavior from the current
  PR head.

Key decisions:
- Plan an unresolved recovery intent in the webhook transaction; choose and
  reserve the healthy sender only inside the transport transaction.
- Revalidate active access, participant identity, exact assigned incoming line,
  hard-block status, pinned sender health, and persisted delivery shape before
  provider entry.
- Key recovery by member, failed incoming line, and provider group thread so
  repeated source events converge on one delivery.
- Centralize provider-status normalization because routing, projection, and
  contact-card reconciliation all interpret the same provider state.

State:
- The ReviewGPT implementation is reconciled with the current-day capacity
  remediation and reduced to the existing routing, capacity, delivery, and
  provider-dispatch owners.
- Parent review confirmed that hard-blocked group recovery is resolved at
  dispatch time, revalidates authority and delivery shape, reserves capacity
  atomically, and converges repeated source events on one delivery.
- Focused verification passed 287 tests. Web typecheck and lint passed with
  zero errors, and the canonical diff suite passed.
- Canonical remote acceptance passed on the exact candidate with the synthetic
  environment profile, including the full Web build and Cloudflare suites.

Next:
1. Archive this plan and commit the reconciled implementation.
2. Push the exact head and update the PR evidence.
3. Run final ReviewGPT with exact-head CI.

Open questions (UNCONFIRMED if needed):
- None.

Working set (expected):
- `apps/web/src/lib/hosted-onboarding/**`
- `apps/web/test/hosted-onboarding-linq-*.test.ts`
- `agent-docs/operations/imessage-deliverability.md`
- `agent-docs/references/hosted-runtime-protocol.md`
- this plan

Status: completed
Updated: 2026-07-29
Completed: 2026-07-29
