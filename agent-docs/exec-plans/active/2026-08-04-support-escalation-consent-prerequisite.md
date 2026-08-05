# Require informed support-escalation consent before detailed alerts

Status: active
Created: 2026-08-04
Updated: 2026-08-04

## Goal

- Make the hosted runner show the exact de-identified product-only summary,
  disclose that it may be included in an account-linked support escalation,
  then wait for affirmative approval before submitting.

## Success criteria

- A generic escalation request produces no tool call.
- The member sees the exact safe summary, maximum account-linkage disclosure,
  direct support address, and a natural approval question.
- An affirmative continuation submits that same product-only summary once.
- Group, unverified, or semantically unsafe contexts receive the direct support
  route without an account-linked tool call.
- The consent-capable runner is deployed with immediate rollout and exact
  fingerprint convergence before any follow-up Web release may put issue text
  beside the member id in an email.

## Scope

- In scope: compact Assistant Engine support guidance, focused prompt and
  two-turn real-model scenario definitions, and the owning product, security,
  architecture, deployment, and verification docs.
- Out of scope: Web email formatting, feedback persistence, schemas, callback
  shapes, flags, queues, retries, recipients, or provider configuration.

## Risks and mitigations

1. Risk: a generic request can authorize unseen account linkage or a summary
   containing semantic private context.
   Mitigation: show the exact product-only summary and linkage, wait for
   affirmative approval, and cover a synthetic private-context scenario.
2. Risk: a later detailed-email Web release can race an old prompt bundle.
   Mitigation: land this behavior separately, deploy Cloudflare/runner with
   immediate rollout, and require exact bundle-fingerprint smoke before the
   follow-up Web PR may merge.
3. Risk: rollout-compatible completion copy can overstate delivery while Web
   still sends metadata only or suppresses email above the daily cap.
   Mitigation: confirm only that the product issue was saved for triage and the
   account-linked escalation was recorded; never claim the issue was emailed.

## Tasks

1. Tighten the compact support authority contract.
2. Add two-turn, privacy, group, and copy regressions.
3. Update the owning durable contracts and rollout order.
4. Run focused tests, typecheck, provider-input measurement, ReviewGPT, and CI.
5. Commit, open the prerequisite PR, and preserve the follow-up PR as a stacked
   Web-only change.

## Decisions

- Split landing is the smallest safe deployment mechanism because production
  runner bundles build only from protected main while Web auto-deploys from
  main. The prompt lands first; no feature flag or consent-version state is
  added.
- The existing Cloudflare source/bundle fingerprint admission and
  managed-container smoke prove runner convergence.
- Maximum disclosure says the approved summary may be included with the
  account-linked escalation. That is informed consent for the follow-up while
  remaining truthful during the metadata-only prerequisite window.
- Ordinary feedback remains silent and best-effort; the assembled developer
  prompt and tool description explicitly exclude reserved support escalation
  from that policy and route it to disclosed approval plus durable completion.

## Verification

- Run focused Assistant Engine support guidance and real-model scenario
  definition suites, Assistant Engine typecheck, docs drift, diff checks,
  provider-input measurement, required ReviewGPT passes, and exact-head CI.
