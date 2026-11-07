# Link pages on the night design

Status: completed
Created: 2026-11-05
Updated: 2026-11-06

## Goal

- Every page a person reaches from a link in a Murph message uses the group funding design: night ground, one headline, one sentence, one pill, one quiet link, and one object where the dial sits.
- Designs are in the Paper file "Murph · Link pages". The owner approved them and authorized shipping on 2026-11-05.

## Success criteria

- A private link shows what it is for before sign-in, with sign-in on the page, and never shows its private subject first.
- Every dead link looks the same.
- Consent wording, sharing descriptions, and privacy promises are unchanged.
- Each PR has rendered proof at phone width and passes its required gates.

## Scope

- In scope: approval, group join and start, Family invite, sign-up, referral, connect, records, browser handoff, calendar, recap, and Add usage.
- Out of scope: marketing pages, the dashboard, the desktop recap, and the challenge invite, which already uses this design.

## Constraints

- Technical constraints: Web only unless a slice says otherwise. `LinkPageFrame` stays at page level because it repaints the document.
- Product/process constraints: group invite links stay phone-only. Sign-in finishes through the provider's own handler. Billing and consent behavior do not change in a presentation slice.

## Risks and mitigations

1. Risk: inline sign-in diverges from the dialog after authentication.
   Mitigation: it calls the provider's `handleAuthCompleted` through `completeAuthentication`, so there is one owner.
2. Risk: a private subject shows before sign-in.
   Mitigation: signed-out states take no approval data, and the sheet shows a lock.
3. Risk: Add usage moves a purchase out of Settings.
   Mitigation: its own slice and review, because `DESIGN.md` limits post-purchase handoffs there today.

## Tasks

1. Shared shell, sheet, on-page sign-in, and the approval flow.
2. Calendar, recap, referral, Family, group start, and group join.
3. Sign-up.
4. Connect, records, and browser handoff.
5. Settings sign-in and Add usage.

## Decisions

- The approval keeps the server's sentence word for word, and the sheet reads the file name from it, so no backend or schema change is needed.
- The server title "Send a file from your vault?" stays for now, because changing it needs a runner deploy.
- Group join rows show names only after owner review. The exact wording is one tap away, and the visible sentence always says the name is shared.
- Add usage has no dial. The button can charge a saved card straight away, so the amount is never preselected.
- The `Usage added` handoff is not built: `DESIGN.md` keeps personal usage returns quiet, and that is the owner's call.

## Verification

- Commands to run: focused `apps/web` tests, typecheck, and a phone-width render of each state.
Completed: 2026-11-06
