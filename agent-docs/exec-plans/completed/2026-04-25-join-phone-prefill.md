# Join Phone Prefill

## Goal

Restore the join invite phone-number prefill when an invite was issued from an existing stored signup phone, so users who texted Murph first do not need to re-enter the same number.

## Scope

- Hosted web join invite status/page data.
- Join invite phone-auth component/controller input seeding.
- Focused hosted-web tests for the regression.

## Constraints

- Preserve server-side invite phone verification; prefill is convenience only, not authority.
- Do not print or fixture real invite codes, phone numbers, secrets, or local identifiers.
- Preserve unrelated dirty work in the shared tree, including existing onboarding copy edits and Health Commons content lanes.

## Plan

1. Expose a nullable invite phone prefill from stored hosted member identity state.
2. Pass the prefill through the join invite verification panel into the phone auth controller.
3. Reset invite phone entry back to the prefill when restarting the invite phone flow.
4. Add focused tests covering the status payload and rendered invite phone auth props.
5. Run focused hosted-web checks, required audit passes, then close the plan.
Status: completed
Updated: 2026-04-25
Completed: 2026-04-25
