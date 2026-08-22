# Make Starter enrollment consent-owned

Status: active
Created: 2026-08-22
Updated: 2026-08-22

## Goal

- A fresh invited member who accepts the final launch-consent scope continues
  through the correct messaging, billing, or Starter owner in that same
  authenticated server request, so closing the tab or losing client hydration
  immediately afterward cannot strand or misroute signup.

## Success criteria

- The ordinary join-consent request carries the invite continuation explicitly.
- The server invokes the existing idempotent Starter boundary only after both
  launch scopes are current, and that boundary revalidates the app session,
  invite ownership, suspension, messaging readiness, direct billing, and
  Family recovery before any grant.
- Messaging and billing recovery defer successfully to their existing
  server-rendered owners; actual Starter completion reuses the full-document
  Home or armed group-start handoff.
- Consent calls outside invited onboarding retain their current behavior.
- A lost response or retry can repeat the same request without another Starter
  grant or a second activation owner.
- Focused route, client, component, and page tests pass; exact-head CI and the
  required preliminary and final ReviewGPT gates resolve with no accepted
  finding left open.

## Scope

- In scope: the invited Web launch-consent handoff, its authenticated API
  continuation, focused regression coverage, current architecture/reliability
  docs, and a member-visible changelog entry.
- Out of scope: Privy webhook ingestion, a queue or workflow, historical bulk
  repair, changing consent copy or layout, and removing the existing
  pre-consented/retry enrollment fallback.

## Constraints

- Technical constraints: preserve the legal-consent owner and the canonical
  Starter enrollment service; no GET mutation, new persisted state, external
  provider, long transaction, or duplicated activation logic.
- Product/process constraints: Patch-level Product UX. Preserve the existing
  consent promise and visible flow while making its continuation durable.
  Use the PR worktree lane, focused local proof, exact-head CI, one preliminary
  specialist ReviewGPT pass, and the sensitive final ReviewGPT loop.

## Risks and mitigations

1. Risk: a generic consent call accidentally starts onboarding.
   Mitigation: require an explicit invite continuation field supplied only by
   the join island, and still revalidate it in the canonical enrollment owner.
2. Risk: the first of two launch-scope acceptances starts too early.
   Mitigation: continue only when the returned authoritative status says all
   launch scopes are granted.
3. Risk: consent commits while another onboarding owner still has work.
   Mitigation: return committed consent with a request-scoped deferred result
   and refresh into the existing messaging or billing owner. Preserve errors
   only for unexpected or genuinely retryable Starter failures.
4. Risk: a stale page races Family recovery and appends Starter capacity.
   Mitigation: re-read every Family recovery state under the existing
   member/beneficiary lock before the grant boundary.
5. Risk: a Privy authentication webhook becomes a second activation authority.
   Mitigation: do not add it. Privy proves authentication, not Murph consent,
   invite ownership, messaging readiness, or billing eligibility.

## Tasks

1. Trace the consent, join, and Starter owner paths and challenge the smallest
   handoff against auth, consent, retry, and deployment invariants.
2. Pass the invite continuation through the existing join consent request and
   perform enrollment after the final committed launch scope.
3. Add focused proof for ordinary two-scope completion, non-final consent,
   non-join consent, retry/error behavior, client payload, and page prop flow.
4. Update durable ownership/reliability docs and changelog, then run focused
   tests, typecheck, lint/diff checks, and the Product UX walkthrough.
5. Commit and push the candidate, open the PR, launch preliminary specialists
   and final ReviewGPT round 1 concurrently with CI, disposition every result,
   remediate accepted findings, and finish the plan only after all gates pass.

## Decisions

- Use the existing legal-consent POST as the continuation boundary instead of
  a Privy webhook. The server already has the authenticated member and the
  authoritative post-commit consent status there.
- Reuse the existing Starter enrollment implementation and return one
  request-scoped enrolled-versus-deferred branch; do not move or copy
  activation logic and do not make page rendering mutate state.
- Reuse the existing Family recovery resolver under the Starter member lock and
  the existing browser full-document/group-start handoff after enrollment.
- Keep the current Starter island as recovery for already-consented historical
  or interrupted states; the ordinary fresh path no longer depends on it.

## Product UX

- Outcome: accepting the final required consent either finishes Starter or
  advances to the existing messaging or billing recovery owner without relying
  on another enrollment effect.
- Reaches: fresh invited members, retries after an ambiguous response, and
  existing non-onboarding consent callers whose behavior remains unchanged.
- Proof: exercise the real two-request consent card, verify enrollment occurs
  only on the final response, verify the canonical enrollment arguments, and
  prove a replay remains safe through the existing idempotent owner.

## Product UX walkthrough

- Fresh Starter-ready member: the same consent card and copy remain visible.
  The first scope records consent only; the final scope finishes Starter on the
  server, then performs the established full-document Home or group-start
  handoff.
- Messaging or billing recovery: consent succeeds, creates no Starter grant,
  and refreshes into the current server-owned setup or recovery screen.
- Ambiguous response or retry: consent may already be current, but the repeated
  request reaches the same semantic Starter grant and activation owner. The
  existing retry message remains available if that owner returns a retryable
  failure.
- Other consent callers: requests without the explicit invite continuation do
  not enter enrollment and retain the existing consent and health-runtime
  ordering.
- Evidence: 86 focused Vitest cases passed across the consent route, real join
  island, join page/view, and canonical Starter enrollment service; Web
  typechecking and rendered browser proof remain to be refreshed on the final
  candidate head.
- Verdict: implementation proof passes; final browser and exact-head review
  evidence remain pending.

## Verification

- Commands to run: focused Vitest files for legal consent routes, join islands,
  join page/view, client API, and Starter enrollment; Web typecheck and lint or
  the smallest truthful diff-aware lane selected after the final file set;
  `git diff --check`; exact-head GitHub Actions.
- Expected outcomes: all focused checks pass; the join consent payload carries
  the invite continuation; the first scope does not enroll; the final scope
  enrolls once; unrelated consent calls do not enroll; ReviewGPT and required
  CI have no unresolved accepted findings.
