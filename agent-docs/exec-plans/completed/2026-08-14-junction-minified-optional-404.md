# Restore first-time Junction device connections in production

Status: completed
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

## Progress

- The production failure was traced to an upstream optional 404 whose SDK error
  class name was rewritten by minification. A focused minified-bundle
  reproduction proved the existing literal-name check was the failing boundary.
- PR #1813 merged the transport-owned correction as commit `ea9d023663`. Focused
  Junction tests, package and Web typechecks, changelog validation, the
  minified-bundle proof, required CI, and the final cross-cutting review passed.
- The preliminary coverage review requested stronger journey and cancellation
  proof. The follow-up tests now exercise resolve-404 -> create-user ->
  sign-in-token under a rewritten SDK class name, plus caller cancellation
  during unread 404-body cleanup. The full Junction test file and package
  typecheck pass locally.
- The first production build of the merge commit was OOM-killed by Vercel's
  Standard build machine during the Next.js compile. A later `main` deployment
  containing the hotfix completed successfully and owns the public production
  aliases. The homepage returned 200 after its canonical redirect, the
  unauthenticated companion sign-in-token probe failed closed with 401, and the
  deployment showed no device-sync server errors after activation.

## Verification

- Commands to run: focused `device-syncd` Junction tests, package typecheck, a
  minified-bundle reproduction, exact-head CI, preliminary
  `completion-specialists` ReviewGPT, final ReviewGPT, clean merge-tree proof,
  and metadata-only production log inspection after deployment.
- Expected outcomes: a first-time lookup returns `null`, create-or-resolve can
  create the provider user, all required checks pass, and the production route
  stops emitting the diagnosed lookup failure.
Completed: 2026-08-14
