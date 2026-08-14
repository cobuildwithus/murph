# Restore first-time Junction device connections in production

Status: active
Created: 2026-08-14
Updated: 2026-08-14

## Goal

- Restore first-time Apple Health connection setup when Junction correctly
  reports that the deterministic provider user does not exist yet.

## Success criteria

- A Junction user lookup that receives an upstream 404 returns `null` even
  when production bundling changes SDK error class names.
- The existing create-or-resolve flow proceeds to provider-user creation after
  that optional lookup.
- Abort and timeout authority still take precedence over optional-response
  handling, and the unread response body remains cancelled.
- Focused regression tests, package typecheck, exact-head review, and required
  CI pass before the production deployment is considered complete.
- Production logs no longer show the diagnosed optional lookup failure after
  the fixed deployment becomes active.

## Scope

- In scope: Junction client optional-404 classification, focused regression
  coverage, and production deployment verification.
- Out of scope: provider data imports, account mutation, provider SDK upgrades,
  Apple HealthKit behavior, or unrelated Junction resource work.

## Constraints

- Keep the transport response as the source of truth; do not depend on class
  names that a production minifier may rewrite.
- Preserve the existing bounded retry, timeout, cancellation, and secret-safe
  provider diagnostic behavior.
- Use only synthetic test identifiers and metadata-only production evidence.

## Risks and mitigations

1. Risk: treating a late 404 as optional could mask a caller cancellation.
   Mitigation: keep parent-abort and timeout checks ahead of the optional-404
   return and assert that ordering in existing abort coverage.
2. Risk: an ordinary source-level test could miss the production-only failure.
   Mitigation: make the regression reproduce the SDK class-name rewrite caused
   by minification and retain the existing response-body cancellation proof.
3. Risk: unrelated provider behavior could change during an urgent fix.
   Mitigation: limit the runtime change to the already-declared optional-404
   path and leave general SDK error handling unchanged.

## Tasks

1. Reproduce the minified SDK error-name failure on current `main`.
2. Add a focused failing regression and the smallest transport-owned fix.
3. Run focused tests, package typecheck, and a minified-bundle scenario proof.
4. Commit and push the candidate, open the PR, and complete required ReviewGPT
   and exact-head CI gates.
5. Merge, verify the Vercel production deployment and logs, close this plan,
   and retire the worktree.

## Decisions

- Record the observed optional 404 inside the injected transport. The transport
  directly owns the HTTP response and remains stable when the SDK bundle's
  constructor names are minified.

## Verification

- Commands to run: focused `device-syncd` Junction tests, package typecheck, a
  minified-bundle reproduction, exact-head CI, preliminary
  `completion-specialists` ReviewGPT, final ReviewGPT, clean merge-tree proof,
  and metadata-only production log inspection after deployment.
- Expected outcomes: a first-time lookup returns `null`, create-or-resolve can
  create the provider user, all required checks pass, and the production route
  stops emitting the diagnosed lookup failure.
