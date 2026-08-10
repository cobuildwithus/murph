# Fix referral claim origin policy

Status: completed
Created: 2026-08-09
Updated: 2026-08-09

## Goal

- A recipient who opens a valid reusable referral link can select **Join Murph**
  and continue into ordinary signup without a JSON origin error, while the
  stable referral token remains absent from downstream referrer headers.

## Success criteria

- The referral landing uses an origin-only referrer policy whose non-GET form
  submission supplies the canonical origin required by the existing CSRF guard.
- Cross-origin, missing-origin, and opaque-origin claim requests remain rejected.
- Focused route/UX tests, the Web typecheck, and a production-shaped browser
  form-submission proof pass.
- Required specialist/final ReviewGPT gates and exact-head CI pass before merge.
- Production deployment is verified with a fresh synthetic referral journey;
  no private member token is reused as test evidence.

## Scope

- In scope: referral landing referrer policy, its durable product contract,
  focused regression coverage, PR/deploy proof, and incident handoff.
- Out of scope: changing the shared browser-mutation CSRF guard, weakening
  cross-origin admission, referral reward accounting, or onboarding semantics.

## Constraints

- Technical constraints: preserve the signed-token privacy boundary and the
  same-origin POST claim owner; prefer the existing global `strict-origin`
  security posture over a new token or client-side submission layer.
- Product/process constraints: keep confidential reported URLs and identifiers
  out of repository artifacts and external coordination; use the isolated PR
  lane and required exact-head review gates.

## Risks and mitigations

1. Risk: accepting origin-less requests would weaken CSRF protection.
   Mitigation: change only the initiating page policy; keep the route guard and
   its rejection behavior intact.
2. Risk: a more permissive referrer policy could leak the stable token.
   Mitigation: use `strict-origin`, which sends only the origin and never the
   path token, including to cross-origin destinations.
3. Risk: unit fixtures could pass while real browser headers still differ.
   Mitigation: capture the submitted request headers through a real browser
   against a synthetic local origin before handoff.

## Tasks

1. Add a focused regression that binds the referral page to an origin-only
   policy compatible with the protected POST.
2. Replace the conflicting `no-referrer` page metadata with `strict-origin` and
   update the live referral product contract.
3. Run focused route, UX, CSRF, config, and typecheck proof plus a real-browser
   submission check.
4. Inspect the diff for privacy and scope, then commit, push, and open the PR.
5. Run preliminary specialists and final ReviewGPT with exact-head CI, resolve
   findings, merge, deploy, and verify the production journey.

## Decisions

- Root cause: the landing's `no-referrer` policy makes a non-GET same-origin
  form submission serialize an opaque `Origin`; the claim route then correctly
  rejects it. This is a page-policy conflict, not a reason to weaken the guard.
- Use `strict-origin`: the repository already applies it globally, it keeps the
  token path out of referrer headers, and it preserves canonical-origin proof.

## Verification

- Focused referral UX, route, hosted-onboarding CSRF, and Next security-header
  suites passed: 4 files and 63 tests.
- The Web typecheck passed, and a real Chromium submission proved that the
  canonical `Origin` is present while the token path is absent from `Referer`.
- The preliminary specialist pass and final ReviewGPT round 1 returned no
  findings on the shipped head. Required runnable CI checks passed except the
  design-proof bookkeeping gate, which is closed by the catalog binding in the
  follow-up commit.
- The production deployment for PR #1492 succeeded. A synthetic invalid-token
  smoke proved that the live landing emits `strict-origin`, a same-origin claim
  reaches ordinary referral handling with a `303`, and a foreign-origin claim
  remains rejected with a `403`.
- The existing synthetic referral-flow design study is explicitly bound to the
  origin-only claim contract, and its focused 10-test suite plus the prepared
  Web typecheck passed.

## Outcome

- PR #1492 shipped the smallest correction: the referral page now uses
  `strict-origin`; the mutation guard and onboarding semantics are unchanged.
- Existing reusable referral links remain valid and no migration is required.
- No private referral token was reused in tests, repository artifacts, review
  packets, or production smoke evidence.
Completed: 2026-08-09
