# Require informed support-escalation consent before detailed alerts

Status: active
Created: 2026-08-04
Updated: 2026-08-05

## Goal

- Make the hosted runner show the exact de-identified product-only summary,
  disclose that it may be included in an account-linked support escalation,
  then wait for affirmative approval before submitting.

## Success criteria

- A generic escalation request produces no tool call.
- The member sees the exact safe summary, maximum account-linkage disclosure,
  and a natural approval question without an unrequested support address.
- An affirmative continuation submits that same product-only summary once.
- Group, unverified, or semantically unsafe contexts receive a private support
  route without an account-linked tool call; the address appears only if asked.
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
- Ordinary feedback remains best-effort; a clear accepted Murph product failure
  may receive one brief product-team acknowledgement. The assembled developer
  prompt and tool description exclude reserved support escalation from that
  policy and route it to disclosed approval plus durable completion.

## Verification

- Run focused Assistant Engine support guidance and real-model scenario
  definition suites, Assistant Engine typecheck, docs drift, diff checks,
  provider-input measurement, required ReviewGPT passes, and exact-head CI.

## Verification log

- Focused prompt, prompt-budget, tool-contract, and real-model scenario suites
  pass 99 tests; 25 credential-gated live-provider cases compile and skip.
  Assistant Engine typecheck, docs drift, and diff checks pass. The compact
  execution-kernel runtime literal is 2,990 characters / 2,994 UTF-8 bytes and
  passes its strict sub-3,000-byte ratchet.
- The original production App Server paired capture plus exact serialized-field
  correction measurement uses `gpt-5.6-terra`, low reasoning, the exact support
  tool, identical direct/group fixtures, and `gpt-tokenizer` 3.4.0
  `o200k_harmony`. Direct moves from 22,938 tokens / 106,468 bytes to 23,020 /
  106,951 (+82 tokens, +0.3575%; +483 bytes, +0.4537%). Group moves from 19,504
  / 91,094 to 19,586 / 91,577 (+82 tokens, +0.4204%; +483 bytes, +0.5302%).
  Attribution is +22 tokens/+116 bytes for compact base support guidance
  (the first-reviewed +20/+108 plus correction +2/+8),
  +30/+190 for the ordinary-feedback exception, and +30/+177 for the
  support-aware tool description; schema and other provider fields are zero.
- Preliminary specialist ReviewGPT found three valid gaps: phase-one completion
  copy overstated linked-summary delivery, ordinary silent feedback guidance
  conflicted with reserved support consent, and the resumed scenario did not
  compare displayed and submitted summaries exactly. All were accepted and
  corrected at the existing prompt, tool-description, and test owners.
- Final ReviewGPT round 1 independently reproduced the same delivery-overclaim
  mechanism at the immutable `0c85fae178` head. The marked response completed
  in the exact managed tab with substantive findings; its capture process did
  not persist the already-complete turn, so the response was inspected directly
  without relaunching the audit. The correction uses maximum disclosure before
  approval and a completion claim valid for metadata-only delivery, later
  detailed delivery, daily-cap suppression, and replay.
- Correction-verification ReviewGPT round 2 at `755e6cbb9c` returned `PASS`
  with no findings. Its documentation discrepancies were reconciled: runtime
  kernel size, complete provider attribution, and potential rather than definite
  linkage in the architecture/security owners. Exact-head CI passed before this
  explanatory doc correction. Production fingerprint convergence remains a
  post-merge deployment prerequisite, so the stacked Web PR stays draft.
