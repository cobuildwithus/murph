# Retell phone-call usage accounting

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Count each terminal Retell phone call's provider-reported combined cost exactly once in the existing hosted included-usage allowance.

## Success criteria

- Completed, failed, unanswered, and zero-cost Retell calls produce one deterministic hosted usage row and at most one allowance-period increment.
- Provider-reported combined cost in cents is converted to integer USD micros without estimating from duration or product names.
- Transfer calls wait for `transfer_ended` so transfer-leg cost is included.
- Duplicate, reordered, and concurrent terminal callbacks converge on the same immutable usage identity.
- The pre-armed phone-call reconciliation workflow retrieves terminal provider usage when callbacks are lost.
- Retell cost remains web-owned and cannot be asserted through the signed hosted-runtime usage callback.
- Focused tests, full acceptance, required coverage review, PR CI, and exact-head ReviewGPT all pass.

## Scope

- In scope: Retell terminal payload parsing, webhook subscription/routing, a web-internal deterministic usage writer, allowance pricing for that trusted record shape, the existing reconciliation workflow, focused tests, and current Retell docs.
- Out of scope: direct Stripe metered invoicing, hard usage enforcement, a second usage aggregate, provider product-level cost persistence, and unrelated phone-call behavior.

## Constraints

- Use the stored `HostedPhoneCall.memberId` as billing authority; never trust callback metadata for member attribution.
- Persist only bounded aggregate cost facts, not transcripts, recordings, destinations, or product labels.
- Keep the runtime usage parser unable to accept provider-reported Retell cost.
- Preserve current result, privacy, storage-mode, and provider-authority gates.

## Risks and mitigations

1. Risk: `call_ended` can precede a transfer leg's final cost.
   Mitigation: defer `call_transfer` observations until `transfer_ended` or terminal provider retrieval.
2. Risk: webhook replay or reconciliation can double count usage.
   Mitigation: derive one usage id from the immutable Murph phone-call id and reuse the existing usage-row and allowance compare-and-set owners.
3. Risk: callback loss can leave a call permanently unaccounted.
   Mitigation: keep the pre-armed reconciliation step pending until the provider call is terminal and its deterministic usage record is accounted.
4. Risk: a runtime-supplied usage record could forge provider cost.
   Mitigation: construct and persist Retell cost only inside `apps/web`; do not add its raw cost key to the shared runtime parser allowlist.

## Tasks

1. Add strict terminal Retell usage normalization and a web-internal deterministic usage writer/pricer.
2. Account signed terminal callbacks, including `transfer_ended`, independently of post-call result success.
3. Extend the existing provider reconciliation path to retrieve and account terminal usage after callback loss.
4. Add focused replay, transfer, zero/fractional-cost, attribution, reconciliation, and period tests; update durable Retell docs.
5. Run focused verification, coverage review, full acceptance, parent final review, close the plan with a scoped commit, then open the PR and run CI plus ReviewGPT concurrently.

## Decisions

- This PR updates Murph's advisory cost-weighted included usage. It does not enable the intentionally disabled Stripe usage export or introduce per-call overage invoices.
- Retell's `call_cost.combined_cost` is authoritative because it includes provider products, discounts, and transfer-leg cost.
- `HostedAiUsage` and `HostedAiUsagePeriod` remain the only usage row and aggregate owners.

## Verification

- Focused Retell routes/runtime/reconciliation and hosted allowance suite: 6 files, 193 tests passed.
- `pnpm --filter ./apps/web typecheck:prepared`: passed.
- Required `coverage-write`: found one oversized-cost ingress boundary; the committed regression and bounded parser fix passed its focused 9-test route suite.
- `pnpm verify:acceptance`: workspace guards, all app/package typechecks, web build, web lint, web dev smoke, and all 5,289 web tests passed. The workspace coverage fan-out later exhausted its 4 GB Node heap in an unrelated CLI meal-import test and emitted one unrelated worker-exit error; the exact CLI file passed cleanly afterward (8 tests).
- Remaining handoff gates: `git diff --check`, exact-head ReviewGPT, PR CI, and clean merge proof against current `main`.
Completed: 2026-07-16
