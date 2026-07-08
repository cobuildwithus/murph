# Group Container Roster Access

Status: completed
Updated: 2026-07-06

## Why

Hosted group containers currently inherit access only from the container owner.
That makes a group unavailable when the owner lapses even if another current
participant has active Murph access.

## Scope

Add a persisted projection of resolved hosted thread-container participants,
reconcile it off the inbound/delivery hot path from the existing Linq roster
read path, and grant group-container access when the owner has active access or
any non-removed participant has active access.

## Constraints

- No synchronous Linq roster fetch on webhook ingestion or egress delivery.
- Do not change provisioning owner selection, home-line gates, routing keys, or
  billing grace semantics.
- Suspended containers still hard-block access regardless of participant access.
- Store only participants that resolve to hosted members; soft-remove departed
  participants on successful roster reconciliation.
- Keep the owner as the data/budget anchor.

## Implementation Notes

- Add `HostedThreadContainerParticipant` plus an additive migration.
- Add `reconcileHostedThreadContainerParticipants` as a best-effort helper that
  accepts pre-fetched handles so `read_chat_participants` does not fetch twice.
- Add `hasAnyActiveHostedThreadContainerParticipant` and use it only as an
  additive fallback at the ingestion inactive-container gate and egress
  authority check.

## Verification Plan

- `pnpm --dir apps/web prisma:generate`
- Focused hosted-web tests covering reconcile, ingestion access, and egress
  authority.
- `pnpm --dir apps/web typecheck`

Completed: 2026-07-06
