# PR 932 Round 13 Identity Retrospective

Status: completed

## Goal

Resolve the competing signup-attempt identities exposed by ReviewGPT round 13,
delete the mismatch compensation, and make every webhook response truthful about
whether its required signup link sent.

## Proven gap

A later inbound source event can plan a different group-aware signup link while
the member/day delivery key is owned by an older in-flight event. The transport
suppresses the later send as an intent mismatch, but the webhook still responds
with `sent-signup-link`.

## Retrospective direction

- Generic signup remains one delivery identity per member and UTC day.
- A group-aware signup reply is a distinct exact-source-event identity. Different
  replies no longer compete for one provider idempotency key.
- The persisted group context remains the immutable replay source for that exact
  event, while current database state is revalidated before every provider claim.
- Group-aware outcomes are independent of the generic member/day sent marker;
  accepted or failed group links consume or reopen only their exact outreach.
- Linq's documented 5xx retry window is approximately 25 minutes, which crosses
  the existing 15-minute ambiguity window, so the original webhook remains the
  restart continuation owner without another scheduler or queue.

## Scope

- signup effect identity and source-reference codec
- delivery claim/retry consequences and direct transport drain responses
- group-aware daily-suppression boundaries
- focused route/unit and PostgreSQL restart/multiple-intent proof
- PR retrospective, change-shape, rendered-evidence, and verification evidence

## Invariants

- One provider idempotency key represents one exact inbound signup intent.
- A different group reply can never rewrite, suppress, or impersonate another
  event's delivery.
- A no-send outcome is never reported as `sent-signup-link`.
- Generic first-contact anti-duplication remains one link per member/day.
- Accepted group-aware delivery consumes only the selected outreach, and a failed
  delivery reopens only that outreach.
- No new persisted owner, scheduler, queue, migration, or reconciliation loop.

## Verification

- Focused signup identity, transport, route/service, provider receipt, and
  multiple-intent tests: 304 passed.
- Production-faithful PostgreSQL crash/retry and independent-intent proof:
  1 passed.
- Web typecheck passed; lint completed with zero errors.
- `pnpm test:diff apps/web` passed 520 files / 6,649 tests, with 13 files /
  173 tests skipped, plus dev smoke and the production build.
- `pnpm verify:acceptance` passed every workspace typecheck, package coverage
  threshold, package boundary, Web verification, and Cloudflare verification.
- Exact-head ReviewGPT continuation and CI run after plan closure and
  base-branch reconciliation.

Updated: 2026-07-26
Completed: 2026-07-26
