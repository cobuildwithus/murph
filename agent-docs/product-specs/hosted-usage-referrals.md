# Hosted usage referrals

## Status

Active implementation contract for earned usage rewards. Web owns attribution,
qualification, receipts, caps, and credit accounting. Linq and Telegram
normalize conversational mission evidence into the same provider-neutral state
machine. Shareable signup links reuse the same receipt, cap, and credit-ledger
primitives without inventing a second mission lifecycle.

There are two independent rollout gates:

- `HOSTED_USAGE_REFERRALS_ENABLED=1` enables conversational referral missions;
- `HOSTED_SIGNUP_REFERRAL_REWARDS_ENABLED=1` enables rewards for attributed
  signup-link activations.

The stable referral link itself remains available to an active signed-in member
when either reward gate is disabled.

## Product behavior

Murph may offer conversational missions when trusted usage context says a
personal or group Murph is running low. When the current sender explicitly asks
how to get more usage or what options exist, Murph checks current mission
availability even when usage is healthy and presents returned earned paths
beside separately authorized plan, top-up, or group-funding paths.

Describing a mission is not consent. Murph arms a mission only after the person
explicitly chooses its exact server-returned policy. Different policies may be
active at the same time.

| Path | Qualification | Public reward label |
| --- | --- | --- |
| Stable signup referral link | A genuinely new member completes ordinary Murph activation through an invite attributed to the sharing member. | About 100 more messages |
| `new_person_activation_v1` mission | The referrer starts a fresh Murph iMessage group with a genuinely new person. That person activates after the mission was armed and speaks in the bound target group. | About 100 more messages |
| `active_group_v1` mission | A fresh group reaches 15 qualifying human messages, including at least 8 messages from at least 2 non-referrer speakers, across at least 10 minutes. | About 140 more messages |

The message labels describe the approximate value of each fixed offer. The
ledger continues to store exact cost-weighted usage value in USD micros. Actual
message capacity varies by model, tools, media, task complexity, and response
length, so these labels must never be reused to estimate a member's current
messages remaining.

Trial rewards add usage capacity but never extend the trial end date.

## Stable signup referral links

Every active member has one deterministic, signed referral URL:

```text
/r/<versioned-signed-token>
```

The token is bound to the referrer by the existing app-session HMAC authority
under a separate domain. It contains no phone number, email address, health data,
or recipient identity. HMAC-key rotation revokes outstanding stable URLs.

Link issuance is read-only and creates no placeholder member, invite,
attribution row, or reward state. The same issuance function serves:

- the existing runtime `create_signup_referral_link` action when a member asks
  Murph for their link;
- the authenticated Settings `Copy link` action.

A public `GET /r/<token>` only validates the token and renders a small landing
page. Link previews, crawlers, and scanners therefore cannot allocate onboarding
state. An explicit same-origin `POST /r/<token>/claim` creates a fresh ordinary
`/join/<inviteCode>` invite and placeholder member. Every claimant receives
isolated onboarding state, while `HostedInvite.referrerMemberId` remains attached
to that invite throughout ordinary onboarding.

Claims reuse the referrer's existing member-row lock and the `HostedInvite`
table. At most 50 `signup-referral` invites may be created for one referrer in a
rolling hour. The count is checked under that lock and before creating a
placeholder member, so a shared link cannot produce unbounded abandoned accounts
without adding another rate-limit service or persistence owner.

Existing recipient-bound `/join/<inviteCode>` URLs remain valid. The browser
never selects the referrer, reward, policy, destination, or accounting amount.

## Attribution and qualification

`HostedInvite.referrerMemberId` is the durable signup-link attribution source.
`member.activated` is the durable qualification evidence. A signup-link reward
requires exactly one distinct referrer on invites created no later than that
activation. Attribution is re-read under the referrer lock before settlement.
Ambiguous historical attribution fails closed.

Conversational missions continue to use `HostedUsageReferral` as their durable
multi-event lifecycle owner:

```text
armed -> target_bound -> rewarded
   \         \-------> expired | disqualified
    \---------------> canceled | expired
```

A signup-link activation is already one complete durable qualification event. It
does not fabricate a group target, participant subject, or `target_bound` phase.
Instead, one transaction creates the standard rewarded `HostedUsageReferral`
receipt and its immutable referral grant. A distinct policy version preserves
accurate Settings copy without relying on an ID prefix or a second table.

`superseded` remains a legacy terminal status for rows created by the original
one-at-a-time mission contract. New arming does not emit it.

## Conversational mission evidence

The hosted runtime injects current Linq or Telegram sender handles from accepted
input context. The model cannot provide identity, beneficiary, route, target,
amount, counters, or provider authority. Personal direct calls resolve to the
authenticated runtime member. Group calls fail closed unless exactly one
provider-scoped current sender resolves to an active personal member.

One newly created group binds every compatible policy that its creator has
armed. Existing groups cannot bind. The new-person group mission remains exact
Linq iMessage-only because its reciprocal contact-card onboarding path is
currently iMessage-owned. SMS, RCS, and Telegram remain eligible for the
provider-neutral active-group mission.

Provider adapters pass only:

- target container member ID;
- a provider-domain-separated message lookup key;
- occurrence time;
- resolved sender member ID when already authorized;
- a provider-domain-separated sender subject key.

Raw phone numbers, email addresses, Telegram IDs, message IDs, and chat IDs do
not enter referral rows. A personal mission source stores only runtime-produced
`hid_` conversation locators. Event and speaker keys are bounded, deduplicated,
and cleared at terminal state.

One admitted inbound human provider message counts once. Murph output,
reactions, empty unsupported events, and duplicate provider events do not count.
The active-group rule measures observed participation rather than a provider
roster so it remains portable across Linq and Telegram.

Provider occurrence time, not delivery order, decides admission. Evidence at or
after expiry is ignored. A bound row and its cap commitment remain eligible for
delayed pre-expiry evidence through 25 hours after the occurrence window closes.
The first referrer-serialized expiry boundary after that grace terminally clears
an unqualified row.

An unlinked Telegram participant in an already-bound group may contribute only
bounded referral evidence. Their message remains excluded from the assistant
mailbox, grants no assistant access, and produces no setup reply in that group.

Provider timing references:

- [Linq webhook delivery guarantees](https://docs.linqapp.com/guides/webhooks/)
- [Telegram incoming-update retention](https://core.telegram.org/bots/api#making-requests-when-getting-updates)

## Credit accounting and serialization

`HostedUsageCreditEntry` remains the immutable accounting owner. Each
`purchase_grant` or `referral_grant` freezes its source and provenance. The
one-to-one `HostedUsageCreditGrant` row stores only that entry's mutable
remaining-capacity projection.

- Purchase fulfillment creates a `purchase_grant` entry plus its projection.
- Every referral path creates a `referral_grant` entry plus its projection.
- Usage settlement consumes projected grant capacity FIFO by immutable entry.
- Refund and dispute reconciliation can touch only purchase-backed entries.
- Referral-backed entries have no financial reversal or clawback path.

Grant identity is:

```text
hosted-usage-credit:referral:<referral-id>:grant:v1
```

Both signup-link rewards and conversational missions serialize through the same
referrer advisory-lock namespace, beneficiary member lock, and introduced-member
advisory-lock namespace. This prevents cap races, double attribution, and a link
reward racing a group-mission reward for the same person.

Rolling capacity includes recent completed rewards plus outstanding armed and
bound mission commitments:

- at most $10.50 per referrer in a rolling 30-day window;
- at most $20 per beneficiary in a rolling 30-day window.

The referrer cannot reward their own reconciled identity. Suspended referrers or
introduced members are disqualified. One introduced member can own only one
referral receipt across all acquisition paths.

Signup-link receipt creation and grant insertion commit atomically. A failed
grant rolls back the receipt. Replays observe the existing receipt and cannot
append another credit entry. The focused PostgreSQL concurrency proof runs two
independent clients through concurrent settlement and replay and requires one
receipt, one immutable entry, one remaining-capacity projection, and one member
ledger increment.

## Recovery and celebrations

The existing Vercel-authenticated referral recovery cron remains the only
scheduler. Each bounded pass:

1. scans up to 50 recent attributed `member.activated` events when signup-link
   rewards are enabled;
2. atomically settles eligible signup-link receipts and grants;
3. reconciles up to 50 ordinary qualified missions or ordinary rewarded
   referrals awaiting a source celebration;
4. re-signals up to 50 oldest unconsumed referral-celebration mailbox items.

No signup-specific queue, scheduler, outbox, grant worker, or notification path
exists.

Conversational mission completion remains celebrated in its frozen source
conversation. Group notifications carry live external-thread authority. Personal
notifications require the frozen direct thread and never move to a newer home
conversation.

Signup-link rewards are deliberately notification-free in the first version.
They create no source-conversation record, no synthetic "challenge complete"
message, and no false `celebrationQueuedAt` marker. The member receives the
usage immediately and sees the completed `Invite someone to Murph` entry in
Settings history. Notification delivery therefore cannot delay, reverse, or
duplicate a signup-link reward.

A failed conversational notification cannot duplicate or claw back its reward.
Once a mailbox item is durable, failed signaling leaves that same item eligible
for the next bounded pass.

## Settings projection

Settings keeps the combined AI usage meter as the aggregate balance owner. The
Referrals detail surface is read-only:

- `Copy link` is available to every active signed-in member, independent of the
  conversational mission rollout gate or messaging channel;
- `Ask Murph` appears only when conversational missions are enabled and a
  supported Murph conversation exists;
- current mission rows show title, status, deadline, approximate message reward,
  and reward owner;
- qualification requirements and selection date stay in one native details
  disclosure;
- completed mission and signup-link rewards appear in History;
- signup-link rows use their persisted policy version to display `Invite someone
  to Murph` rather than masquerading as the fresh-group mission;
- purchase-grant history follows referral history as a flat ledger;
- the surface creates no second balance, lifecycle, counter, participant list,
  or group-name store.

Opening Settings or copying a link never arms a mission or creates reward state.

## Privacy and deletion

Unrewarded referral state is deleted when the referrer, beneficiary, introduced
member, or target container is deleted. Credit entries and their
remaining-capacity projections are deleted when their beneficiary is deleted.

If an identity-owning participant deletes their account after a surviving group
already earned the reward, deletion must not claw back that group's credit. The
rewarded accounting receipt remains only while its beneficiary remains and is
anonymized by clearing referrer, introduced-member, target-container,
subject-key, source-conversation, and observation evidence. This minimal receipt
preserves grant provenance without retaining cross-account identity.

Stable referral URLs contain only a random internal member identifier inside an
authenticated token. They contain no recipient or health information. A claimant
cannot see the referrer's private conversations, files, connected data, or
health information.

## Deployment and rollback

The stable-link surface is Web-only and schema-free. Deploy the `/r/<token>`
landing page, explicit claim route, authenticated Settings endpoint, and runtime
handler together before sharing stable URLs. Existing `/join/<inviteCode>` URLs
remain compatible.

Keep `HOSTED_SIGNUP_REFERRAL_REWARDS_ENABLED` unset during deployment. Before
enabling it:

1. confirm exact-head unit, typecheck, app, viewport, and design-proof checks;
2. run the focused local-PostgreSQL concurrent settlement and replay proof;
3. smoke one attributed activation and confirm one receipt, entry, grant, member
   balance increment, and accurate Settings history;
4. replay the activation/recovery pass and confirm no second grant;
5. smoke one cap rejection and one self-referral rejection;
6. exercise the 50-claims-per-hour boundary and confirm the rejected claim
   creates no placeholder member or invite.

Disabling the signup-reward gate immediately stops new activation scans. It does
not revoke stable links, hide prior history, or claw back existing credit.

Once the first signup-link referral grant exists, Web must not roll back below a
version that understands referral-backed entries and the signup policy version.
Forward-fix or keep this Web head or newer. Rolling back only the public link
route after URLs have been shared would make those stable entry points
unavailable, although already-created `/join/<inviteCode>` descendants remain
ordinary invites.
