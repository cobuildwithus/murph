# Self-service recovery for a blocked plan change

## Outcome and protected invariants

Members blocked by a scheduled cancellation can open existing Stripe billing management directly from the plan-change dialog. Preserve explicit cancellation intent, all plan-change admission checks, authenticated portal ownership, and Stripe as the payment/retry owner. No automatic cancellation removal or new billing writes.

## Evidence and existing owners

The known cancellation diagnostic reaches the Settings dialog, which currently offers only retry/close. The existing BillingPortalButton already provides authenticated self-service management. The supported Stripe portal configuration permits renewal before scheduled cancellation, invoice access, and payment-method updates. Failed payment and requested cancellation are distinct contracts; retained provider evidence shows retries and subsequent payment do not cancel a separately requested cancellation.

## Product UX

- Effort: Product change within the existing recovery flow.
- Outcome: Explain the block and make Manage billing actionable without support.
- Reaches: Authenticated personal Settings plan-change dialog and matching design catalog.
- Journeys: Cancellation error opens portal on explicit click; unrelated errors preserve retry; portal failure stays visible; ordinary scheduling still succeeds.
- State and authority: Existing ephemeral error state and portal component only; no schema, billing mutation, cancellation reversal, retries, or new owner.
- Failure/skew: Old server responses retain the known cancellation code. New client can show recovery from that code. Old clients receive the clearer message. Portal errors remain actionable and do not imply renewal.
- Proof: Synthetic regression fails before change; owner/Settings tests, Web typecheck, phone/desktop rendering, final ReviewGPT and exact-head CI.

## Implementation

- [x] ReviewGPT supplied the generic dialog, service-copy, and regression patch.
- [x] Parent inspected the patch, mirrored the small correction in the separate Edge-to-Pulse dialog, reproduced both missing actions and both cancellation-copy cases before the change, and updated catalog, changelog, and owner guidance.
- [ ] Verify, close plan, commit/push follow-up PR as Draft, then Ready.
- [ ] Final round 1 on pushed head and required CI; human merge only.

## Decisions and evidence

No production mutation is authorized by this task. Existing completed plan is historical and remains unchanged. PR4151 merged during investigation. Continue in a new sanctioned worktree from current main; preserve the merged branch and prior completed plan.

## Focused verification

Four targeted regressions fail against the base implementation. The patched billing Settings, plan-switch service, payment-status, portal-route, and portal-button suites pass all 132 tests; changelog passes 39 tests. Web typecheck, raw-log privacy guard, complexity (no hotspot above 20), docs drift, and docs gardening pass. Real Chromium rendering at 390px and 1440px fits the changed section. Separate catalog overflow is recorded through Frog. Product UX: Ready at the local composed boundary; authenticated Stripe renewal was not performed because production investigation is read-only. Required CI and final ReviewGPT remain explicit PR completion gates.
