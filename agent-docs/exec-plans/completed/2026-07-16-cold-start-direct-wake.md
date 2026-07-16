# Cold-start direct wake overlap

## Goal

Reduce established Linq reply startup latency by starting the authorized,
idempotent Cloudflare runner ensure without waiting for the durable Temporal
handoff to finish first.

Success criteria:

- Start the direct ensure and Temporal signal from the same post-commit,
  access-validated boundary.
- Continue requiring a successful Temporal handoff before accepting the webhook.
- Preserve existing best-effort direct-ensure failure handling and post-response
  lifecycle ownership.
- Cover ordering and partial-failure behavior with focused tests.

## Constraints

- Keep Temporal as the durable orchestration owner and mailbox state as the
  durable work source of truth.
- Add no queue, scheduler, persisted handoff state, or alternate retry owner.
- Preserve active hosted-ingress wake work and unrelated changes.
- Keep private identifiers, payloads, credentials, and local paths out of
  committed artifacts.

## Approach

1. Prove the current serial handoff boundary and existing idempotence contract.
2. Launch the direct ensure concurrently with the Temporal signal after access
   validation.
3. Await Temporal as the acceptance gate, then retain the direct ensure through
   the existing post-response mechanism.
4. Add focused ordering and failure-path regression coverage.
5. Run scoped verification, required coverage review, CI, and ReviewGPT.

## State

Active.

## Notes

- Runtime evidence showed the direct Cloudflare ensure was unnecessarily
  delayed behind Temporal acceptance even though both operations are safe to
  start from the same durable mailbox boundary.
- This overlaps the non-exclusive hosted-ingress wake lane only at the narrow
  handoff helper and its focused tests.
Status: completed
Updated: 2026-07-16
Completed: 2026-07-16
