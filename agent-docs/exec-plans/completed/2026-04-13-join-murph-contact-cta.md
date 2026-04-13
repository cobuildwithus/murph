# Join Murph Contact CTA Plan

## Goal

Replace the generic hosted join-page `Open Messages` action with member-specific `Text Murph` and `Add Murph to Contacts` actions once a matched invite reaches the active state.

## Why

The current active-state CTA uses a generic `sms:` link, which can open compose UI without clearly targeting the member's assigned Murph line. The join flow already knows the assigned hosted routing number after activation, so the page should expose that number more directly and offer a durable contact-save action.

## Scope

- `apps/web/src/lib/hosted-onboarding/**`
- `apps/web/app/api/hosted-onboarding/**`
- `apps/web/src/components/hosted-onboarding/**`
- `apps/web/test/**`

## Constraints

- Only expose the assigned Murph number for authenticated sessions that match the invite.
- Keep the payload surface narrow; avoid introducing a broad generic contact model.
- Preserve existing active-state fallback behavior when no Murph number is available yet.
- Avoid leaking unrelated private routing data in tests, logs, or docs.

## Plan

1. Extend hosted invite status with an authenticated active-state Murph phone field.
2. Add a narrow vCard download route gated to the matched invite session.
3. Update the active join panel to render `Text Murph` and `Add Murph to Contacts`.
4. Add or update focused tests for payload gating, CTA rendering, and vCard output.
5. Run truthful scoped verification for `apps/web`, inspect diffs, and commit touched paths.
Status: completed
Updated: 2026-04-13
Completed: 2026-04-13
