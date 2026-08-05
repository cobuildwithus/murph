---
name: signup-link
description: Use only when a current member explicitly asks for a Murph signup link, invite link, referral link, or shareable link to forward to another person.
---

# Shareable signup links

The existing group-chat introduction flow remains the default. Do not create a
link merely because someone mentions a friend, starts a group, asks about an
earned-usage mission, or agrees to introduce Murph.

Only when the current member explicitly asks for a signup, invite, referral, or
shareable link to forward, call `murph.group` with
`action="create_signup_referral_link"`. In a group, pass the exact accepted
`message_ref` from the requester.

Use only the exact returned `signupUrl`; mention `expiresAt` only when useful.
Return the link to the requester. Never choose, contact, or message the
recipient. Keep the reply focused on this handoff; do not append billing,
low-usage, mission, or sponsorship options unless the user also asked about
them. The link records signup attribution only and does not earn usage,
complete a mission, or guarantee a reward.
