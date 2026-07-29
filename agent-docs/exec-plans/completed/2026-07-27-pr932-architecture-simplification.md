# PR 932 Architecture Simplification

Status: completed

## Goal

Reduce PR 932's duplicated outreach and delivery lifecycle while preserving the
automatic one-opener group-join flow, exact group recovery after reply, phone
privacy, deletion ownership, quiet hours, line limits, and provider
idempotency.

## Accepted direction

1. Keep one narrow `HostedGroupJoinOutreach` as the durable pre-member intent,
   dedupe, scheduling, and remove-before-add owner.
2. Make `HostedLinqDelivery` the sole provider-attempt, correlation, retry,
   receipt, and terminal-outcome owner through a direct outreach relation.
3. Make the canonical join offer the sole group owner and derive the group
   through a real offer relation.
4. Put irreversible opener dispatch behind one bounded fence that serializes
   against phone-identity creation and account/group deletion.
5. Preserve the exact inbound reply occurrence time durably; do not delete its
   current source-reference representation without a smaller equivalent owner.
6. Remove the group-offer sentence that announces possible private outreach;
   the automatic behavior remains unchanged.

## Work

1. Ask the existing ReviewGPT architecture thread for a scoped patch against
   exact head `48e5346b9b8edbcca315e58842cb754806f8572f`.
2. Inspect the entire returned patch, reject speculative machinery, and apply
   only behavior-preserving simplification.
3. Update schema and the unshipped PR migration directly; add no compatibility
   branch for a schema that has not deployed.
4. Update focused unit and PostgreSQL proofs for both member-creation/send race
   orderings, delivery-derived reply availability, receipt recovery, and
   deletion.
5. Update current architecture, reliability, deliverability, and verification
   docs only where the durable owner contract changes.

## Verification

- Focused Web tests for outreach store/drain, Linq delivery and transport,
  reaction handling, account deletion, and PostgreSQL recovery scenarios.
- `pnpm test:diff apps/web`
- `pnpm verify:acceptance`
- Direct PostgreSQL race and deletion scenarios.
- Required product-experience review, preliminary ReviewGPT specialist pass,
  parent final review, final ReviewGPT gate, CI, and merge-conflict proof.

Updated: 2026-07-27
Completed: 2026-07-27
