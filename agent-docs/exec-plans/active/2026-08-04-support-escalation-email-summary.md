# Include the validated product issue in support escalation alerts

Status: active
Created: 2026-08-04
Updated: 2026-08-05

## Goal

- Include the stored closed-vocabulary product issue in the immediate
  internal alert created after an explicit verified-private request for Murph
  human support, without showing the summary or adding a separate approval turn.

## Success criteria

- The first three eligible support alerts per member per UTC day render readable
  labels from the first parsed stored product-area/problem issue together with
  the existing internal feedback and member identifiers.
- An explicit verified-private human-support request may submit immediately;
  generic feedback remains anonymous, group or unverified requests stay
  account-unlinked, and the support address remains opt-in.
- Exact callback replay reuses the same stored issue and Resend idempotency key
  even if a later callback selects different codes. Missing, linked, free-form,
  legacy, or malformed stored detail fails before provider entry.
- The member-linked row remains fixed server-authored metadata, the anonymous
  detail row contains only the shared canonical area/problem shape, and the
  existing cap, authority, and plain-text delivery behavior stay unchanged.
- Focused Web and Assistant Engine tests, affected typechecks, docs checks,
  exact-head CI, required reviews, and parent final review pass.

## Scope

- In scope: Web-owned canonical-detail readback and parsing, support-alert
  formatting from allowlisted labels, focused regressions, and owning
  product/security/reliability docs.
- Composed prerequisite: #1305 owns the one-turn Assistant Engine authority,
  de-identification guidance, opt-in address, and truthful completion copy.
- Out of scope: raw transcript inclusion, schema changes, recipients, daily
  digest behavior, retry or queue ownership, and provider changes.

## Constraints

- Use the existing anonymous detail row for the shared canonical area/problem
  value. Derive replay email content only after parsing stored state, preserve
  the daily cap and provider key, and add no state owner or dependency.
- Treat this as a private-data exposure change: run product-experience and
  coverage specialist review, final cross-cutting ReviewGPT, exact-head CI, and
  a parent final review.

## Risks and mitigations

1. Risk: model-authored prose can retain semantic private detail even after
   deterministic scrubbing.
   Mitigation: #1305 accepts only allowlisted area/problem codes for reserved
   support. Web rejects free-form reserved input and stored detail, parses the
   shared canonical value, and renders only labels derived from those codes.
2. Risk: callback codes change while replay reuses one provider key.
   Mitigation: validate both deterministic rows and treat the first stored
   anonymous detail as canonical; fail before Resend on invalid storage.
3. Risk: an alert accepted before the email body change is replayed with the
   same provider key during Resend's 24-hour retention window.
   Mitigation: retain the key so the provider fails closed instead of
   duplicating the alert; monitor the bounded transition without compatibility
   state.
4. Risk: runner and Web releases deploy at different times.
   Mitigation: merge #1305 first for Git sequencing, then #1284. Deploy Web
   before the hosted runner so the direct-send producer reaches a canonical-
   issue-aware consumer. The unchanged callback and response envelopes need no
   compatibility floor.

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
- The email contains readable labels derived only from the parsed product area
  and problem; it never contains the whole member message or model-authored
  prose.
- The anonymous detail row stores the full shared canonical issue; the linked
  row stays fixed server-authored metadata.
- Provider retries format from read-back stored detail, not callback memory.
- The two PRs are one product release. #1305 can merge first, then #1284; Web
  deploys before the hosted runner. No consent version, rollout floor, feature
  flag, or new state is required.

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
- The stacked preliminary specialist found that deterministic scrubbing was not
  semantic disclosure authority for free-form issue text emailed beside a
  member identifier, and that the composition from model payload to Web email
  lacked production-faithful proof. Both findings are accepted: #1305 now owns
  a shared closed area/problem contract and real-provider argument proof; this
  PR parses the same canonical value, renders only its labels, rejects legacy
  or free-form stored detail, and tests the shared builder through the Web
  persistence/email path.

## Verification

- Run the focused Web support service and callback-route suites, the focused
  Assistant Engine support suites inherited from #1305, Web and Assistant Engine
  typechecks, docs drift, and diff checks.
- Expected outcome: an eligible email includes one labeled canonical issue,
  excludes the reserved prefix and all model-authored context, replay preserves
  body and key, free-form or invalid stored detail prevents provider entry, and
  the one-turn direct conversation and group rejection contracts remain green.
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
- After restacking #1305's closed-vocabulary remediation, the focused Web
  support service and callback-route suites pass 14 tests. The production path
  proves canonical builder-to-storage-to-parser-to-email composition, semantic-
  context rejection before persistence, canonical replay, and legacy free-form
  stored-detail rejection before provider entry. The composed Assistant suites
  pass 106 tests with 27 credential-gated cases compiled and skipped, and the
  shared hosted contract passes 6 tests. Full Web, Assistant Engine, and Hosted
  Execution typechecks pass; docs drift and diff checks pass. Exact-head CI and
  correction ReviewGPT remain pending.
