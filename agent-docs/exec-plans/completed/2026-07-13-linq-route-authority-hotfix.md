# Linq legacy route-authority hotfix

## Goal

Stop production Linq 403s for legacy or restored runtime inputs that carry
exact current-inbound proof but predate persisted external-thread route
authority metadata.

Success criteria:

- Admit a legacy current-inbound request only when its target resolves to the
  bound runtime member's durable Linq thread route.
- Keep inactive, wrong-member, stale, and unproved route requests fail-closed.
- Add production-shaped regression tests for the allowed and denied cases.
- Run focused web verification, required audits, and push the scoped fix to
  `main`.

## Constraints

- Preserve the existing durable thread-route and hosted-access owners.
- Do not weaken participant first-contact, explicit authority, or home-route
  checks.
- Do not add persisted state, a queue, or a second authority source.
- Keep diagnostics and committed artifacts free of private identifiers and
  secrets.

## Approach

1. Reproduce the legacy payload against a matching durable thread route.
2. Validate the route's container member and active access before allowing the
   legacy compatibility path.
3. Add regression coverage for matching, wrong-member, and inactive routes.
4. Run focused verification, completion audits, final review, and the scoped
   commit workflow.
5. Reconcile with the latest remote `main`, push, and verify deployment health.

## State

Active.
Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
