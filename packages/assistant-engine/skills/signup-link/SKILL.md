---
name: signup-link
description: Use only when a current member explicitly asks for a Murph signup link, invite link, referral link, or shareable link to forward to another person.
---

# Shareable signup links

The existing group-chat introduction flow remains the default. Do not create a
link merely because someone mentions a friend, starts a group, asks about an
earned group referral option, or agrees to introduce Murph.

Only when the current member explicitly asks for a signup, invite, referral, or
shareable link to forward, call `murph.group` with
`action="create_signup_referral_link"`. In a group, pass the exact accepted
`message_ref` from the requester.

Use only the exact returned `signupUrl`; mention `expiresAt` only when useful.
Treat it as the member's reusable referral link: do not imply that one recipient
consumes it or that the member needs a fresh link for each later recipient.
Return the link to the requester. Never choose, contact, or message the
recipient. Keep the reply focused on this handoff; do not append billing,
low-usage, group referral, or sponsorship options unless the user also asked about
them.

Sharing or opening the link does not earn usage, qualify for a group referral
reward, or guarantee a reward. If a recipient later finishes their own Murph setup through
an invite attributed to that link and the referral qualifies under server
policy, Murph adds any referral reward automatically. When helpful, explain that
distinction in one short sentence. Do not promise a fixed reward or amount that
the tool did not return.
