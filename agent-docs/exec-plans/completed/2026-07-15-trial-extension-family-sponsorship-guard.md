# Trial extension Family sponsorship guard

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Prevent the manual Pulse Trial extension flow from mutating a direct Stripe
  subscription when the member already has active Family-sponsored access.

## Production proof

- The manual extension reconciled nine local trial rows.
- Seven subscriptions remained trialing.
- The other two were canceled immediately by the existing canonical Family
  sponsorship cleanup path.
- A one-time salted comparison proved those two rows were exactly the two
  members with active, unsuspended Family sponsorship.

## Success criteria

- Preview returns an explicit ineligible result for active Family-sponsored
  members without reading or mutating Stripe.
- Apply rechecks Family sponsorship under the existing member billing lock and
  fails stale if sponsorship changed after Preview.
- Ordinary eligible trial extension and recovery behavior remains unchanged.
- Post-deploy marker cleanup targets only the seven subscriptions that remain
  canonical trialing subscriptions.

## Constraints

- Reuse canonical Family sponsorship derivation from member access.
- Do not add persisted state or a second billing owner.
- Keep member, customer, subscription, and provider request identifiers out of
  logs and committed artifacts.

## Tasks

1. Add the Family-sponsored eligibility code and canonical access check.
2. Add focused no-provider Preview and stale-Apply regressions.
3. Run routed verification and required coverage/state audits.
4. Prepare the corrected PR head and a bounded counts-only post-deploy cleanup.

## Outcome

- Preview rejects active Family sponsorship before any Stripe read.
- Apply repeats that check inside the existing member billing lock and treats a
  newly active sponsorship as stale Preview state.
- Focused regressions, the full diff verification suite, coverage review, and
  billing state-consistency review all passed.
- The post-deploy cleanup remains bounded to the seven canonical subscriptions
  that are still trialing and will clear only the obsolete target marker.
Completed: 2026-07-15
