# Refine WHOOP full-sync dialog actions

Status: active
Created: 2026-07-22
Updated: 2026-07-22

## Goal

- Make the expanded WHOOP Apple Health setup guide say `Download App` and give members a lower-priority `Continue with Murph` action that uses their already-resolved Messages or Telegram route.

## Success criteria

- The App Store CTA displays `Download App` while retaining its descriptive accessibility label and destination.
- `Continue with Murph` uses the existing contact destination as an outline secondary CTA; the no-contact case remains a safe in-dialog continuation.
- Focused tests, the canonical diff-aware verification lane, desktop/mobile browser proof, required reviews, CI, and mergeability checks pass.

## Scope

- In scope: the expanded WHOOP setup-guide action block, its server-owned visible label, and focused regression coverage.
- Out of scope: the summary completion dialog, other provider completion flows, contact-route resolution, or new design-system components.

## Constraints

- Technical constraints: reuse `model.contactAction`, existing button variants, and current route metadata; add no state owner, dependency, or custom component.
- Product/process constraints: preserve the two-step WHOOP instructions, contact-route authority, no-contact fallback, and existing primary/secondary hierarchy.

## Risks and mitigations

1. Risk: the new label looks interactive but only dismisses the dialog.
   Mitigation: route it through the existing member contact action whenever one is available and test the destination.
2. Risk: Telegram accessibility copy does not disclose its channel or new-tab behavior.
   Mitigation: derive a bounded action-specific aria label from the existing contact-action metadata.

## Tasks

1. Update the setup-guide CTA copy and reuse the contact action in the expanded view.
2. Add focused regression proof for visible labels and contact routing.
3. Capture desktop/mobile rendered evidence and complete the routed review, verification, PR, CI, and mergeability gates.

## Decisions

- Use the existing outline contact-link treatment already shown beneath `Get full sync`; do not introduce another contact component or adapter.
- Keep an outline `Continue with Murph` close action when no contact destination exists so the visual hierarchy stays stable without inventing a route.

## Verification

- Commands to run: focused Vitest for `device-sync-completion-dialog-client.test.ts`, `pnpm test:diff` for the touched app files, and `git diff --check`.
- Expected outcomes: all checks pass; desktop and mobile show one filled download CTA above one outline contact CTA with the requested labels.
