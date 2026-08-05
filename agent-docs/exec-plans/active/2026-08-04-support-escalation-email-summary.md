# Include de-identified issue text in support escalation alerts

Status: active
Created: 2026-08-04
Updated: 2026-08-05

## Goal

- Include the stored bounded, de-identified product issue in the immediate
  internal alert created after an explicit verified-private request for Murph
  human support, without showing the summary or adding a separate approval turn.

## Success criteria

- The first three eligible support alerts per member per UTC day render the
  first stored anonymous issue together with the existing internal feedback and
  member identifiers.
- An explicit verified-private human-support request may submit immediately;
  generic feedback remains anonymous, group or unverified requests stay
  account-unlinked, and the support address remains opt-in.
- Exact callback replay reuses the same stored issue and Resend idempotency key
  even if the callback is reworded. Missing, linked, or malformed stored detail
  fails before provider entry.
- The member-linked row remains fixed server-authored metadata, the anonymous
  detail row remains the only durable free-text owner, and the existing cap,
  authority, and plain-text delivery behavior stay unchanged.
- Focused Web and Assistant Engine tests, affected typechecks, docs checks,
  exact-head CI, required reviews, and parent final review pass.

## Scope

- In scope: Web-owned stored-detail readback and validation, support-alert
  formatting, focused regressions, and owning product/security/reliability docs.
- Composed prerequisite: #1305 owns the one-turn Assistant Engine authority,
  de-identification guidance, opt-in address, and truthful completion copy.
- Out of scope: raw transcript inclusion, schema changes, recipients, daily
  digest behavior, retry or queue ownership, and provider changes.

## Constraints

- Use the existing normalized and scrubbed anonymous detail row as the only text
  owner. Derive replay email content from stored state, preserve the daily cap
  and provider key, and add no state owner or dependency.
- Treat this as a private-data exposure change: run product-experience and
  coverage specialist review, final cross-cutting ReviewGPT, exact-head CI, and
  a parent final review.

## Risks and mitigations

1. Risk: a model-authored summary can retain semantic private detail after
   deterministic scrubbing.
   Mitigation: #1305 requires a bounded product-only summary and synthetic
   semantic-private-context proof; Web emails only the read-back scrubbed
   anonymous detail and never reads conversation content.
2. Risk: callback wording changes while replay reuses one provider key.
   Mitigation: validate both deterministic rows and treat the first stored
   anonymous detail as canonical; fail before Resend on invalid storage.
3. Risk: an alert accepted before the email body change is replayed with the
   same provider key during Resend's 24-hour retention window.
   Mitigation: retain the key so the provider fails closed instead of
   duplicating the alert; monitor the bounded transition without compatibility
   state.
4. Risk: runner and Web releases deploy at different times.
   Mitigation: they retain the same callback payload, persisted rows, and result
   shape. Runner-first temporarily keeps metadata-only email; Web-first enriches
   already-valid reserved escalations. No compatibility floor is required.

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
- The email contains the normalized content after `Support escalation:`, labeled
  as the product issue.
- The anonymous detail row remains the single durable text owner; the linked row
  stays fixed server-authored metadata.
- Provider retries format from read-back stored detail, not callback memory.
- Runner and Web changes are operationally independent. The PR stays stacked
  only for review and ordinary merge sequencing; no consent version, rollout
  floor, feature flag, or new state is required.

## Review history

- Earlier review rounds evaluated a superseded preview, linkage-disclosure, and
  affirmative-approval design. Their consent-specific conclusions and rollout
  prerequisite do not apply to the current direct-send product decision.
- Still-valid implementation findings remain landed: the first stored detail is
  canonical on replay, and missing, linked, or malformed detail fails before
  provider entry. The revised exact head requires fresh product/privacy review.

## Verification

- Run the focused Web support service and callback-route suites, the focused
  Assistant Engine support suites inherited from #1305, Web and Assistant Engine
  typechecks, docs drift, and diff checks.
- Expected outcome: an eligible email includes one labeled de-identified issue,
  excludes the reserved prefix and forbidden context, replay preserves body and
  key, invalid stored detail prevents provider entry, and the one-turn direct
  conversation and group rejection contracts remain green.
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
