# Require hosted group membership ids

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Remove the completed #676 deploy-skew compatibility that lets the hosted
  runner accept membership summaries without an opaque `membershipId`.

## Success criteria

- Every successful `list_memberships` entry requires one nonblank
  `membershipId`; omitted, `null`, and blank values fail parsing.
- Assistant tool and skill guidance no longer describe the impossible
  missing-id fallback, while preserving list-first selection, self-only
  authority, and no-guess/no-link-disclosure rules.
- The current Web producer remains unchanged and continues deriving the field
  from the required membership-row primary key.
- The product spec records Web #676-or-newer as the rollback floor while the
  strict runner is active.
- Focused owner tests, scenario integrity, stale searches, diff checks, and the
  truthful diff-aware verification lane pass.

## Scope and constraints

- Keep `memberships: null` for unavailable reads.
- Do not change join-page rendered membership absence, join-confirmation
  optional ids, membership authority, or self-leave behavior.
- Do not edit `apps/cloudflare/DEPLOY.md`; an open PR already owns that file.
- Prefer deletion and keep this as one narrow hosted-group contract hard cut.

## Tasks

1. Tighten the shared response type and parser, and invert legacy parser tests.
2. Delete the dead assistant prompt/skill fallback and update focused tests.
3. Replace the completed rollout prose with the current strict contract and
   rollback order.
4. Run focused and diff-aware verification, then prepare the branch for the
   required coverage audit, exact-head CI, and ReviewGPT.
Completed: 2026-07-15
