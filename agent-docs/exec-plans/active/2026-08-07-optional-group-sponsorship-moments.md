# Optional group sponsorship creative moments

## Goal

Make group sponsorship funding quiet by default while allowing an authorized participant to request one bounded, room-specific message, poem, or 15-second song. A song may include a genre or style reference that Murph converts into broad musical traits without copying a recognizable work.

Success criteria:

- Funding without an explicit creative opt-in creates no public room notification.
- Message, poem, and song are the only accepted creative formats; song alone accepts a style reference.
- New quiet sponsorships remain distinguishable from pre-feature rows so existing in-flight purchases preserve their prior automatic-song behavior.
- Participant-authored creative text is encrypted, request-key frozen, revalidated at payment time, and never becomes tool or policy authority.
- Running-bit activation remains independent from the optional public creative response.
- Focused Web and assistant-engine typechecks, lint, billing guards, docs drift checks, and regression tests pass.

## Scope

- In: group funding personalization UI, sponsorship request contract and encrypted persistence, fulfillment-time notification materialization, creative notification prompt, migration, focused tests, and current product/runtime documentation.
- Out: image generation, a general-purpose creative marketplace, new payment tiers, changes to automatic-refill charging, and unrelated group notification flows.

## Constraints

- Preserve the existing Stripe-only fulfillment authority and purchase-deduplicated mailbox delivery.
- Keep one narrow versioned creative request instead of format-specific database columns or independent workflow state.
- Preserve old-row compatibility without reading expired private participant content.
- Do not make ordinary group funding depend on generated media succeeding.
- Do not merge this branch as part of the implementation task.

## Plan

1. Add the bounded creative request contract and optional sponsorship UI.
2. Persist the request with the existing participant authority, secure-box, digest, and checkout-recovery owners.
3. Activate running bits first, then queue a creative notification only when requested or required for a pre-feature row.
4. Extend the isolated creative prompt for text and song formats with exact song bounds and reference-imitation safeguards.
5. Add migration, compatibility, quiet-default, replay, authority-expiry, and prompt tests.
6. Update the current product and assistant-runtime docs, run focused verification, and open a reviewed pull request without merging it.

## Progress

- Implementation and focused verification are complete; the pull request is awaiting review.
