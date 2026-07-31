# anonymous-product-feedback

Status: active
Created: 2026-07-31
Updated: 2026-07-31

## Goal

- Keep assistant-captured product feedback useful for product triage without
  retaining the submitting member's identity or private health/conversation
  details by default.

## Success criteria

- New hosted product-feedback rows store `member_id = NULL` on the ordinary
  authenticated runtime path.
- Existing hosted product-feedback member associations are cleared during the
  schema migration.
- The callback remains authenticated and member-bound for write authority, but
  the authenticated identity is not forwarded into persistence.
- Feedback idempotency no longer depends on member identity.
- The model-facing contract requires abstraction of private facts to generic
  product concepts, while deterministic contact/secret redaction remains a
  final guardrail.
- Optional member linkage remains server-controlled and nullable for an
  explicitly justified future path; the model and runtime payload cannot choose
  it.
- Focused schema, service, route, assistant-tool, privacy, and migration tests
  pass, along with affected typechecks and exact-head CI.

## Invariants

- Authentication and runtime write-fence checks still authorize every feedback
  submission.
- Feedback storage never receives raw conversation text or health truth.
- Product feedback remains operational product-intake state, not canonical
  member or health state.
- Existing unrelated working-tree changes are preserved.

## Implementation

- Add a forward Prisma migration that clears existing `member_id` values and
  makes the column nullable.
- Make the Prisma relation optional and default the persistence service to an
  unlinked row.
- Stop the authenticated callback route from passing its bound member identity
  into product-feedback persistence.
- Derive deterministic feedback ids from the runtime idempotency key alone.
- Tighten the model-facing privacy rubric and update durable architecture,
  security, and account-data documentation.
- Add focused regression tests proving anonymous persistence, authenticated
  routing without identity forwarding, migration behavior, idempotency, and
  private-detail abstraction.

## Verification

- Pending.
