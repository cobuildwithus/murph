# Hosted managed-automation diagnostics

## Goal

Preserve enough metadata-only production evidence to identify the exact stage
and safe exception identity behind the recurring hosted managed-automation
reconciliation failure.

Success criteria:

- Record a fixed-vocabulary reconciliation stage on failure.
- Preserve safe error name/code/status details already allowed by hosted
  observability without logging vault paths, content, routes, or identifiers.
- Keep foreground reply behavior and reconciliation control flow unchanged.
- Add focused regression coverage and run the required package verification.

## Constraints

- Do not log automation instructions, vault paths, delivery targets, user data,
  or raw exception messages.
- Do not add retries, state, scheduling, or fallback ownership.
- Keep the change inside the existing hosted runtime logging owner.

## Approach

1. Extend the existing failure diagnostic helper with safe structured fields.
2. Track the current fixed-vocabulary managed-automation stage around the
   existing reconciliation call.
3. Prove success and failure log shapes with focused assistant-runtime tests.
4. Run scoped verification, required completion audits, commit, and PR gates.

## State

Active.
Status: completed
Updated: 2026-07-21
Completed: 2026-07-21
