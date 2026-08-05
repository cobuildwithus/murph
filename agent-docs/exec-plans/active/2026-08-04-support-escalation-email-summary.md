# Include the validated product issue in support escalation alerts

Status: active
Created: 2026-08-04
Updated: 2026-08-05

## Goal

- Include Murph's stored bounded, sanitized, de-identified product issue in its
  own words in the immediate internal alert created after an explicit
  verified-private request for Murph human support, without showing the summary
  or adding a separate approval turn.

## Success criteria

- The first three eligible support alerts per member per UTC day include the
  first validated stored issue together with the existing internal feedback and
  member identifiers.
- An explicit verified-private human-support request may submit immediately;
  generic feedback remains anonymous, group or unverified requests stay
  account-unlinked, and the support address remains opt-in.
- Exact callback replay reuses the same stored issue and Resend idempotency key
  even if a later callback supplies different wording. Missing, linked,
  unsanitized, still-prefixed, or malformed stored detail fails before provider
  entry.
- The member-linked row remains fixed server-authored metadata, the anonymous
  detail row contains only Murph's bounded sanitized issue, and the existing
  cap, authority, and plain-text delivery behavior stay unchanged.
- Focused Web and Assistant Engine tests, affected typechecks, docs checks,
  exact-head CI, required reviews, and parent final review pass.

## Scope

- In scope: Web-owned written-issue readback and validation, support-alert
  formatting, focused regressions, and owning product/security/reliability docs.
- Composed prerequisite: #1305 owns the one-turn Assistant Engine authority,
  de-identification guidance, opt-in address, and truthful completion copy.
- Out of scope: raw transcript inclusion, schema changes, recipients, daily
  digest behavior, retry or queue ownership, and provider changes.

## Constraints

- Use the existing anonymous detail row for Murph's sanitized written issue.
  Derive replay email content only after validating stored state, preserve the
  daily cap and provider key, and add no state owner or dependency.
- Treat this as a private-data exposure change: run product-experience and
  coverage specialist review, final cross-cutting ReviewGPT, exact-head CI, and
  a parent final review.

## Risks and mitigations

1. Risk: Murph-written prose can retain semantic private detail even after
   deterministic scrubbing.
   Mitigation: #1305 requires concise product-only wording in Murph's own words,
   forbids copying or quoting the member, and applies the bounded sanitizer.
   Web persists the stripped issue anonymously and validates it again before
   email. The product owner explicitly accepts the remaining semantic risk for
   this verified-private, member-requested support action.
2. Risk: callback wording changes while replay reuses one provider key.
   Mitigation: validate both deterministic rows and treat the first stored
   anonymous detail as canonical; fail before Resend on invalid storage.
3. Risk: an alert accepted before the email body change is replayed with the
   same provider key during Resend's 24-hour retention window.
   Mitigation: retain the key so the provider fails closed instead of
   duplicating the alert; monitor the bounded transition without compatibility
   state.
4. Risk: runner and Web releases deploy at different times.
   Mitigation: merge and deploy #1305's runner first, verify prompt/fingerprint
   convergence, then merge and deploy #1284's Web formatter. Old Web accepts
   the canonical prefix and retains the current metadata-only alert during the
   window; new Web rejects stored detail that does not match the written-issue
   contract.

## Tasks

1. Preserve the existing persistence, email, replay, and privacy ownership.
2. Validate both stored rows and render the first anonymous issue in the alert.
3. Align tests and durable docs with #1305's one-turn direct-send decision.
4. Run focused verification, inspect the complete diff, and push the restacked
   exact head.
5. Run required reviews and CI, resolve findings, close the plan, and finish the
   scoped commit.

## Decisions

- The explicit verified-private request itself authorizes the reserved call;
  Murph does not show the issue summary or ask for separate approval.
- The email contains the validated stored issue Murph wrote in its own words;
  it never contains or copies the member's raw message or private context.
- The anonymous detail row stores the stripped sanitized issue; the linked row
  stays fixed server-authored metadata.
- Provider retries format from read-back stored detail, not callback memory.
- The two PRs are one product release. #1305's runner merges and deploys first;
  after convergence proof, #1284's Web formatter merges and deploys. Roll back
  Web before the runner. No consent version, feature flag, or new state is
  required.

## Review history

- Earlier review rounds evaluated a superseded preview, linkage-disclosure, and
  affirmative-approval design. Their consent-specific conclusions and rollout
  prerequisite do not apply to the current direct-send product decision.
- Still-valid implementation findings remain landed: the first stored detail is
  canonical on replay, and missing, linked, or malformed detail fails before
  provider entry. The revised exact head requires fresh product/privacy review.
- Direct-send final review found one remaining consent-era runner-first rollout
  rule in `agent-docs/RELIABILITY.md`. The finding is accepted: delete only the
  obsolete convergence and rollback sentences while preserving the persistence,
  replay, cap, provider-failure, and no-second-owner contract.
- The stacked preliminary specialist found that deterministic scrubbing alone
  was not semantic disclosure authority for issue text emailed beside a member
  identifier, and that the composition from model payload to Web email lacked
  production-faithful proof. #1305 now owns the explicit verified-private
  authority, own-words/no-copy contract, shared sanitizer, and real-provider
  argument proof. This PR reads and validates that stored issue, rejects linked,
  unsanitized, still-prefixed, or malformed detail, and tests the composed Web
  persistence/email path. The product owner explicitly selected this behavior
  over the closed-vocabulary remediation reviewed in the preceding round.

## Verification

- Run the focused Web support service and callback-route suites, the focused
  Assistant Engine support suites inherited from #1305, Web and Assistant Engine
  typechecks, docs drift, and diff checks.
- Expected outcome: an eligible email includes Murph's one validated stored
  issue, excludes the reserved prefix and the member's raw message or private
  context, replay preserves body and key, invalid stored detail prevents
  provider entry, and the one-turn direct conversation and group rejection
  contracts remain green.
- Provider input impact for this stacked Web diff is not applicable: relative to
  #1305, it changes no prompt, tool schema or description, skill, provider
  configuration, or request assembly. #1305 owns the complete paired capture for
  its provider-visible changes.

## Verification log

- Before the direct-send decision, focused Web support service and route suites
  passed 14 tests, and the Web typecheck passed. The stored-detail formatting,
  stable replay, cap, and failure-before-provider implementation did not change.
- #1305's revised five-suite Assistant Engine proof passes 97 tests with 25
  credential-gated live-provider cases compiled and skipped; Assistant Engine
  typecheck, docs drift, and provider-input measurement pass on its pushed head.
- After restacking the direct-send prerequisite, the two focused Web suites pass
  14 tests and the five focused Assistant Engine suites pass 97 tests with 25
  credential-gated cases skipped. Web and Assistant Engine typechecks, docs
  drift, and diff checks pass on the composed working tree.
- Final correction review round 4 at `500955c856` returned one accepted stale-
  contract finding: RELIABILITY.md still required runner-first consent rollout.
  The rule was deleted without changing runtime behavior or adding machinery;
  PR-relative docs drift and stale-language scans must pass before round 5.
- The closed-vocabulary remediation in the preceding exact-head round was
  superseded by the product owner's clarification that Murph must write the
  de-identified issue in its own words. The restacked candidate keeps the
  anonymous storage boundary, stable replay, and fail-closed provider boundary
  while emailing that validated stored issue beside internal identifiers.
- Exact-head focused tests, typechecks, docs drift, CI, and correction ReviewGPT
  remain pending for this superseding candidate.
