# Vercel telemetry referrer boundary remediation

Status: completed
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Close the accepted round-five privacy finding that same-origin telemetry
  requests can inherit a document pathname and query through the HTTP
  `Referer` header even after `beforeSend` canonicalizes the event payload.
- Preserve the user-directed URL-safe route expansion without adding route
  mounts or query lifecycle state.

## Root cause

The hosted web app sets `Referrer-Policy: strict-origin-when-cross-origin`.
Browsers may therefore attach the complete document URL, including its query,
to same-origin Vercel script and ingestion requests. Normal settings and
callback URLs can contain signed or member-scoped query values.

## Correction

- Change the existing global hosted-web referrer policy to `strict-origin`.
- Retain the stronger `/search/:path*` `no-referrer` override.
- Add direct security-header coverage for both policies.
- Record the telemetry transport boundary in the durable security guidance.

## Round-cap decision

Round 5 returned a validated finding. Continue to one round 6 solely to verify
this accepted correction because the PR cannot satisfy its no-query telemetry
contract while the finding remains uncertified. Do not add new route scope or
review machinery. If round 6 returns another accepted finding, stop and make a
new explicit continuation decision before further review.

## Verification

- Focused next-config and telemetry tests.
- Hosted-web typecheck and focused lint.
- Browser proof that a same-origin request from a query-bearing document sends
  at most the origin as its referrer.
- Agent docs drift, exact-head ReviewGPT, and required PR CI.

Completed local evidence:

- Focused next-config and telemetry Vitest: 45 tests passed.
- Focused ESLint: passed.
- Hosted-web typecheck: passed.
- Chromium reproduction proved the former policy sent the full same-origin
  query and `strict-origin` sent only the origin.
Completed: 2026-07-29
