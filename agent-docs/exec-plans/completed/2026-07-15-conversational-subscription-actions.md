# Conversational subscription actions

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Let the hosted Murph assistant discuss an individual member's current plan
  and usage naturally, then perform only the member's explicit subscription
  choice through Stripe-hosted payment surfaces.

## Success criteria

- Keep `murph.plan_usage` read-only and add one narrow private, input-bound
  subscription mutation tool for continuing Pulse, starting Pulse early, or
  upgrading an active paid Pulse subscription to Edge.
- Reuse the existing Stripe Billing services and return a Stripe-hosted payment
  or payment-method URL only when further user action is actually required.
- Leave an active Pulse trial alone when it already has a valid payment method;
  do not send an unsolicited explanation or payment link.
- Keep commercial conversation natural and non-coercive: no link on the first
  mention, allow "should we part ways?", describe model downgrades in plain
  language rather than internal model names, and never switch models without an
  explicit current-user request.
- Add no webhook, scheduler, schema, custom checkout page, App Clip, commercial
  message state, or new pricing source of truth.
- Pass full repo acceptance, required coverage audit, parent final review,
  green PR CI, and the exact-head ReviewGPT loop through
  `ROUND_OUTCOME: PASS` with zero accepted findings.

## Scope

- In scope: shared hosted-execution contracts/routes, the web-owned Stripe
  action handler and narrow billing-service reuse, Cloudflare signed web-control
  transport, hosted runtime/platform wiring, assistant dynamic-tool guidance,
  focused tests, and current architecture/product documentation.
- Out of scope: the separate 14-day trial change, direct trial-to-Edge
  conversion, proactive trial/usage timers, webhook changes, automatic model
  switching, custom pricing UI, App Clips, family-plan mutations, cancellation,
  and plan catalog redesign.

## Constraints

- Derive member, customer, subscription, price, amount, and destination URLs on
  trusted server boundaries; the model may supply only a bounded action.
- Bind mutations to accepted current-user input and keep the tool unavailable
  in group/shared or non-interactive contexts.
- Preserve existing billing idempotency, locking, reconciliation, usage access,
  and deploy-skew behavior.
- Prefer refactoring a small existing helper over copying Stripe state logic or
  introducing a second billing orchestration layer.

## Risks and mitigations

1. Risk: a conversational yes could trigger an unintended saved-card charge.
   Mitigation: require an explicit current-turn choice, bind the request to the
   accepted input id, consume the per-turn capability on its first action, and
   keep early trial conversion distinct from natural continuation at the
   scheduled trial end.
2. Risk: Stripe returns an incomplete plan change that needs customer action.
   Mitigation: prefer the finalized invoice's hosted payment URL and fall back
   to the existing generic Billing Portal only when no invoice URL is available.
3. Risk: web, Worker, and warm runner versions deploy out of sync.
   Mitigation: make the new port optional and the new action fail closed when a
   layer lacks support; document the safe rollout and direct smoke checks.
4. Risk: prompt guidance becomes a second policy engine.
   Mitigation: keep price, eligibility, and action decisions server-owned; limit
   assistant guidance to when and how to discuss or invoke the bounded tool.

## Tasks

1. Re-map the latest plan-usage, input-authority, billing, and signed-control
   paths and lock the smallest reusable contract.
2. Implement the subscription action contract and web billing handler using the
   existing Pulse/Edge services and Stripe-hosted URLs.
3. Wire the optional signed Cloudflare/runtime/assistant tool path and update the
   conversational guidance and focused tests.
4. Update durable architecture/product docs, run full verification and the
   required coverage audit, then perform the parent final review.
5. Close the plan with a scoped commit, push, open the intent-complete PR, and
   run CI plus the exact-head ReviewGPT loop concurrently to completion.

## Decisions

- `continue_pulse` preserves the current trial and only gathers a missing
  payment method; `start_pulse_now` is the separately explicit immediate-charge
  action.
- Direct trial-to-Edge conversion remains deferred because the current billing
  owner rejects it and this PR should not redesign trial transitions.
- Stripe-hosted invoice and Billing Portal URLs are the checkout UI for this
  version; no Murph-owned plan selector or App Clip is needed.

## Verification

- Commands to run: focused owner tests during implementation; final
  `pnpm verify:acceptance`; `git diff --check`; direct contract/route scenarios;
  required `coverage-write` audit; parent full-diff/call-path review; pushed-head
  ReviewGPT preflight and round(s); PR CI status; and clean merge proof against
  the latest configured base.
- Expected outcomes: all commands green; every mutating action is input-bound
  and server-derived; no no-op trial continuation emits a link; every required
  payment link is Stripe-hosted; no unresolved accepted audit or ReviewGPT
  finding remains.
Completed: 2026-07-15
Completed: 2026-07-15
