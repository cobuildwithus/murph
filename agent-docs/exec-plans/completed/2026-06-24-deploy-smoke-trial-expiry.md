# Deploy Smoke Security and Trial Expiry UX

## Goal

Close the Codex security review finding that deploy-smoke OpenAI authorization is
time-scoped instead of request-scoped, and verify/improve the iMessage UX when a
Pulse Trial member is no longer allowed through the hosted AI usage gate.

Success criteria:

- Deploy-smoke hosted OpenAI authorization is single-use per smoke attempt.
- A second matching OpenAI request in the same smoke window is denied.
- Expired Pulse Trial iMessage users receive a clear action-oriented notice.
- Focused tests cover both behaviors.

## Constraints

- Preserve unrelated dirty work in the connected-apps and Linq formatting lanes.
- Do not expose secrets, direct identifiers, local account names, or home paths.
- Keep the hosted runner egress boundary fail-closed.
- Keep billing/trial behavior monotonic: expired trial state must not fall back
  to paid allowance unless a paid phase is actually recorded.

## Approach

1. Trace the deploy-smoke fence and egress authorization path.
2. Make the deploy-smoke live-model fence consumable once per smoke attempt.
3. Trace the Linq usage-gate denied path and adjust only the user notice copy if
   the current wording is misleading.
4. Add focused tests for request consumption and trial notice copy/delivery.
5. Run scoped Cloudflare and hosted-web tests plus typecheck/diff checks.

## State

Active.

## Notes

- Codex review finding: `audit-packages/pr-162-round-1-retry.md` reports that
  deploy-smoke authorization admits multiple matching `/v1/responses` calls while
  the smoke fence is open.
- Current trial expiry path denies with `trial_expired_pending_billing` and sends
  `trial_conversion_pending` through the Linq `ai_usage_quota` side effect.
Status: completed
Updated: 2026-06-24
Completed: 2026-06-24
