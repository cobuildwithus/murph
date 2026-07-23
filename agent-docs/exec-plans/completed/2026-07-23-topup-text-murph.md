# Text-Murph follow-up on usage top-up success

Status: completed
Created: 2026-07-23

## Goal

- After a member completes a usage top-up (group funding page or Settings),
  the success state offers a primary "Text Murph" action with a prefilled
  message (e.g. "Hey Murph, I just added more usage") so the member can hop
  straight back into the conversation, matching the existing browser-handoff
  reply pattern. Today the fulfilled state shows only "Usage added" and a
  Close button.

## Success criteria

- The top-up dialog's fulfilled state renders a "Text Murph" contact action
  built from the signed-in member's resolved Murph contact channels, with the
  prefilled body varying by scope (group vs personal/family).
- The action only appears when contact channels resolve; the dialog degrades
  to today's behavior when they do not (e.g. no phone on file).
- The group funding page and the Settings top-up surfaces both pass the
  resolved option through; no client-side secret or phone lookup is added.
- Copy is plain language per the repo copy rules; no jargon.
- The real component states are updated on the `/design` catalog with desktop
  and mobile screenshots for the PR.
- Focused tests cover the fulfilled-with-contact, fulfilled-without-contact,
  and non-fulfilled states.

## Scope

- In scope:
  - `apps/web/src/components/settings/hosted-usage-top-up-dialog.tsx` and
    `hosted-usage-top-up-contract.ts` (optional contact-option prop + success
    CTA).
  - `apps/web/app/groups/fund/[joinCode]/page.tsx` and the Settings surface
    that mounts the dialog (server-side resolution via
    `resolveHostedMurphContactOptions`).
  - Reuse of `MurphContactLink` / the multi-channel pattern from
    `computer-handoff-reply-action.tsx`; extract only if reuse requires it.
  - Matching focused web tests and the `/design` catalog study for the dialog.
- Out of scope:
  - Checkout, fulfillment, ledger, or usage accounting changes.
  - The join-invite success surface (parity noted as possible follow-up).
  - New persisted state, routes, or APIs.

## Constraints

- Contact resolution stays server-side (existing resolver); the dialog only
  receives a prebuilt option list.
- Preserve existing failure/pending states unchanged.
- Follow plain-copy rules; no em dashes in user-facing copy.

## Risks and mitigations

1. Risk: on the group funding page an unauthenticated or non-member payer may
   have no resolvable Murph contact.
   Mitigation: the prop is optional and the CTA simply does not render;
   focused test covers it.

## Tasks

1. Add the optional contact-option prop to the dialog contract and render the
   success CTA (primary "Text Murph", Close demoted).
2. Resolve options server-side on the group funding page and Settings surface
   with scope-appropriate prefilled bodies.
3. Update the `/design` catalog states; capture desktop/mobile screenshots.
4. Add focused tests; run `pnpm test:diff` over touched paths.
5. Complete required audits, finish-task commit, open the PR.
Updated: 2026-07-23
Completed: 2026-07-23
