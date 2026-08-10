# Hosted usage referrals

## Status

Active implementation contract for earned usage rewards. Web owns attribution,
qualification, receipts, caps, credit accounting, and the durable completion
notification handoff. Linq and Telegram normalize conversational mission
evidence into the same provider-neutral state machine. Shareable signup links
reuse the same receipt, cap, credit-ledger, recovery, and assistant-notification
primitives without inventing a second mission lifecycle.

Two rollout gates control their respective mutations:

- `HOSTED_USAGE_REFERRALS_ENABLED=1` enables conversational referral missions;
- `HOSTED_SIGNUP_REFERRAL_REWARDS_ENABLED=1` enables rewards for attributed
  signup-link activations.

Public referral marketing derives from those same gates at server render. The
homepage section and footer link appear only when at least one earning path is
enabled. `/refer` lists the enabled earning paths and, while group rewards are
enabled, also keeps the stable personal link visible as a share-only option.
When the signup reward gate is off, that share-only card carries no reward
quantity or promise. When both gates are off, `/refer` shows one
temporary-unavailability state without reward quantities or a share action.
Gate-derived availability is program-level, not a promise that an individual
member has enough rolling capacity for the next reward. Public signup-link
copy therefore states that a completed signup can earn more usage only after
the later eligibility and rolling-limit checks pass.
On the compact homepage referral section, each enabled path leads with a
typical-use estimate (about 10 or 14 more days of Murph usage). These day labels
are presentation estimates, not accounting units; the homepage says that actual
capacity varies, while `/refer` retains the full qualification detail without
exposing internal ledger units.

The stable referral link remains available to an eligible signed-in member when
either reward gate is disabled, but a disabled signup reward is not marketed or
currently promised as an earning path. If the gate is re-enabled, bounded
recovery may still settle an attributed activation from the preceding 30 days
under the ordinary eligibility and capacity checks. The paths share one rolling
cap at their first durable accounting commitment: conversational missions
reserve capacity when armed, while an attributed activation claims capacity
only when recovery atomically creates its receipt and grant under the same
referrer lock.

## Product behavior

Member-facing copy calls the earned group choices **referral options**, never
missions. Internal action names, response fields, and persisted lifecycle
terminology may retain `mission` while they remain compatibility surfaces, but
the website, Settings, assistant explanations, and completion copy use plain
referral language.

Murph may offer conversational missions when trusted usage context says a
personal or group Murph is running low. When the current sender explicitly asks
how to get more usage or what options exist, Murph checks current mission
availability even when usage is healthy and presents returned earned paths
beside separately authorized plan, top-up, or group-funding paths.

Describing a mission is not consent. Murph arms a mission only after the person
explicitly chooses its exact server-returned policy. Different policies may be
active at the same time.

A shareable signup link is different. Murph creates it only when the member
explicitly asks for a signup, invite, referral, or shareable link. Sharing or
opening the link is not a completed referral and does not guarantee a reward.
Murph may explain in one short sentence that a genuinely new completed signup
can earn credit after Murph's later settlement eligibility and rolling-limit
checks pass. Murph never chooses or contacts the recipient and never promises
an amount the tool did not return.

| Path | Qualification | Public reward label |
| --- | --- | --- |
| Stable signup referral link | A genuinely new member completes ordinary Murph activation through an invite attributed to the sharing member, and the referral passes settlement eligibility and rolling-cap checks. | About 10 more days of Murph usage |
| `new_person_activation_v1` mission | The referrer starts a fresh Murph iMessage group with a genuinely new person. That person activates after the mission was armed and speaks in the bound target group. | About 10 more days of Murph usage |
| `active_group_v1` mission | A fresh group reaches 15 qualifying human messages, including at least 8 messages from at least 2 non-referrer speakers, across at least 10 minutes. | About 14 more days of Murph usage |

The day labels estimate typical Murph usage rather than calendar access. The
ledger continues to store the exact usage value in USD micros. The
current display generation anchors the signup/new-person fixed grant at 10 days
and the active-group fixed grant at 14 days. Grants between those anchors
interpolate; grants outside them scale from the nearest anchor. Persisted policy
versions select the display generation, and equal granted capacity within that
generation always yields the same rounded day estimate regardless of referral
path, so current offer changes cannot rewrite a historical receipt's label.
Actual capacity varies by model, tools, media, task complexity, and response
length. A reward never extends a trial end date or subscription period.

Available policies use the current fixed offer. Arming freezes that amount and
policy version on the referral receipt; every active-mission snapshot, grant,
completion notice, and Settings projection thereafter derives the day estimate
from those persisted facts.

Referral rewards add usage capacity but never mint another Starter grant.

## Stable signup referral links

Every eligible signed-in member has one deterministic, signed referral URL:

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
- the authenticated Settings `Copy link` actions.

Each mounted Settings action performs its own authenticated link read. The
server-owned Settings projection supplies a browser-local identity key; an
identity change synchronously renders a safe loading state, aborts or ignores
stale reads, and clears the prior URL before any retry. There is no module-level
or cross-component cache of an identity-bound URL. Once a URL is loaded, copying
happens in the original click without another network request so browser
clipboard gesture requirements remain intact. Success and load-versus-copy
failures are announced accessibly, and a failed preload remains explicitly
retryable.

A public `GET /r/<token>` only validates the token and renders a small landing
page. Link previews, crawlers, and scanners therefore cannot allocate onboarding
state. The route is `noindex`, `nofollow`, and `strict-origin`: referrer headers
carry only the first-party origin, never the stable-token path, while the native
same-origin claim form retains the canonical `Origin` required by its mutation
guard.

The available landing has one action: `Join Murph`, above a single closing line
stating that the link tells Murph who made the introduction and that the
referrer cannot see the recipient's conversations or health information.

Known unavailable links render a human-readable recovery state instead of a
generic 404. A temporarily exhausted claim allowance or unexpected read/claim
dependency or server-configuration failure renders `Try again soon` with a
same-origin `Try again` action that retries the same stable link without
requiring the recipient to reconstruct a clean URL. The native form route
redirects to this HTML state rather than exposing a JSON API error, while the
secret-safe hosted-onboarding logger retains operational evidence. The final
public signup origin is resolved and validated before the claim transaction
opens, and transaction failures roll target member, identity, crypto envelope,
and invite state back before that recovery appears. Invalid cross-origin
submissions remain hard authorization failures and are never disguised as a
link problem.

An explicit same-origin `POST /r/<token>/claim` creates a fresh ordinary
`/join/<inviteCode>` invite and placeholder member. Every claimant—including a
person who uses the reusable link much later—receives isolated onboarding state,
while `HostedInvite.referrerMemberId` remains attached to that invite throughout
ordinary onboarding.

Claims reuse the `HostedInvite` table. The production WAF admits at most 10
matching claim requests per IP per minute. Inside Web, a non-blocking,
feature-local advisory lock serializes one referrer's claim admission without
queuing on account-wide state; a loser immediately receives the retryable busy
state. At most 50 attributed invites may be created for one referrer in a
rolling hour. The count is checked while holding that feature lock and before
the shared member row or placeholder state is touched. An admitted claim checks
active authority without locking the referrer, provisions the pristine target,
then briefly takes the referrer's member row and repeats the authority check
immediately before inserting the attributed invite. Suspension or deletion
that wins that final row order rolls the target member, identity, crypto
envelope, and invite back together. This keeps concurrent claims exact without
holding account-wide state across external crypto preparation, so public claim
pressure cannot queue unrelated billing, activation, Settings, or deletion.

Existing recipient-bound `/join/<inviteCode>` URLs remain valid. The browser
never selects the referrer, reward, policy, destination, or accounting amount.

## Attribution and qualification

`HostedInvite.referrerMemberId` is the durable signup-link attribution source.
`member.activated` is the durable qualification evidence. A signup-link reward
requires exactly one distinct referrer on invites created no later than that
activation. Attribution is re-read under the referrer lock before settlement.
Ambiguous historical attribution fails closed.

`HostedInvite.channel` and invite expiry are onboarding metadata, not referral
authority. Ordinary authenticated onboarding resume may relabel a referral
invite to `web`, and an invite may expire before a verified member's later
activation completes; neither operation clears `referrerMemberId`. Legacy
recipient-bound `/join/<inviteCode>` referrals and descendants created from the
stable link therefore remain attributable when activation happens later, as
long as the attributed invite existed before that activation.

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
accurate Settings copy without relying on an ID prefix or a second table. The
policy-version registry retains old versions when policy semantics change so
historical receipts remain classifiable.

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

Signup activation occurrence remains the immutable qualification timestamp. It
controls invite attribution, the 30-day recovery window, and oldest-first
candidate scanning, but it is not a cap reservation before a receipt exists.
After taking the shared referrer and beneficiary locks, recovery reads the
database clock and evaluates current capacity at that settlement instant using
completed rewards from the trailing 30 days plus the same armed/bound
reservation predicate as conversational admission. There are no application-
timestamp upper bounds: a conversational arm or reward that committed first
counts even if its application host recorded a time slightly ahead of the
database clock. Recovery records one terminal cap disqualification rather than
retroactively invalidating or overbooking that promised commitment. If signup
settlement obtains the locks first, its immutable reward counts before a later
arm is admitted. This lock-ordered accounting is complete without adding
activation-path locks, reservation rows, or another lifecycle.

Recovery still scans activation candidates oldest first. If one candidate fails
transiently, that pass skips later activations for the same referrer so recovery
failure cannot let a later signup steal the next settlement opportunity. While
signup settlement is disabled, attributed activations remain eligible for the
bounded backfill but neither reserve capacity nor pause conversational arming.

The referrer cannot reward their own reconciled identity. Suspended referrers or
introduced members are disqualified. One introduced member can own only one
referral receipt across all acquisition paths.

Signup-link receipt creation and grant insertion commit atomically. A failed
grant rolls back the receipt. Replays observe the existing receipt and cannot
append another credit entry. The focused PostgreSQL concurrency proof runs two
independent clients through concurrent settlement and replay and requires one
receipt, one immutable entry, one remaining-capacity projection, and one member
ledger increment. Its attribution fixture activates weeks after the invite was
created, after invite expiry and a simulated ordinary-resume channel relabel.

## Recovery and completion notices

The existing Vercel-authenticated minute referral recovery cron remains the
only scheduler. For attributed stable-link activations, this scan is the normal
settlement owner rather than a fallback after an immediate activation handoff.
Conversational referrals may also reconcile immediately after qualification;
the same scan remains their idempotent retry owner. It stays on its standalone
route instead of sharing the billing-critical minute Stripe sweep: one pass may
scan or re-signal up to 150 durable candidates, so each owner's timeout and
failure semantics remain independent. Each bounded pass:

1. scans up to 50 recent attributed `member.activated` events when signup-link
   rewards are enabled;
2. atomically settles eligible signup-link receipts and grants;
3. reconciles up to 50 ordinary qualified missions, ordinary rewarded referrals
   awaiting their source celebration, or signup-link rewards awaiting their
   personal completion notice;
4. re-signals up to 50 oldest unconsumed referral-notification mailbox items in
   their actual `system` or `conversation` lane.

The first reward enablement intentionally applies the same oldest-first scan to
at most the preceding 30 days of attributed activations. That bounded window
includes legacy recipient-bound invites with exactly one durable referrer; it is
a controlled backfill, not a prospective-only launch. Before enabling the gate,
operators must run a count-only aggregate over that exact candidate predicate
and keep the gate off if the eligible population or aggregate exposure is not
accepted. Per-referrer rolling caps still apply when each receipt settles, but
the batch size is throughput control rather than a company-wide liability cap.

No signup-specific queue, scheduler, outbox, grant worker, or runtime action
exists. A small policy-aware presenter chooses between the existing ordinary
mission celebration and the signup-link completion notice, then both use the
same assistant-notification mailbox, dedupe key family, signal path, retry fence,
and `celebrationQueuedAt` completion marker.

Conversational mission completion remains celebrated in its frozen source
conversation. Group notifications carry live external-thread authority. Personal
notifications require the frozen direct thread and never move to a newer home
conversation.

After a qualifying signup-link reward commits, Settings history is the durable
visible receipt. When the member has a current authorized Linq or Telegram
route, Murph also sends one concise personal confirmation. It states that
someone completed setup through the referral link and that the receipt's
estimated days of Murph usage are already applied. It does not identify or guess
who joined, mention internal accounting or qualification logic, or ask the
member to do another step. A missing route delays only this notice; it never
delays, reverses, or duplicates the reward.

Once a notification mailbox item is durable, failed signaling leaves that same
item eligible for the next bounded pass regardless of its lane. A notification
failure cannot duplicate or claw back its reward.

## Settings projection

Settings keeps the combined AI usage meter as the aggregate balance owner.
Referral access and history remain read-only projections:

- Messaging always includes a compact `Referral link` row for an eligible signed-
  in account, including first-run, email-only, and mission-disabled members;
- the AI usage `Referrals` surface repeats the same deterministic Copy link when
  mission activity or usage history makes that contextual surface visible;
- each Copy-link action performs its own authenticated read, scopes all local
  state to a server-projected member key, and cannot render or copy a prior
  account's URL during an account transition;
- `Ask Murph` appears only when conversational missions are enabled and a
  supported Murph conversation exists;
- the empty referral explanation says qualifying rewards are added
  automatically;
- current mission rows show title, status, deadline, estimated days of Murph
  usage, and reward owner;
- reward columns stack below descriptions on narrow screens instead of forcing
  horizontal compression;
- qualification requirements and selection date stay in one native details
  disclosure;
- completed mission and signup-link rewards appear in History with the day
  estimate derived from the persisted receipt amount and policy version;
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
health information. Completion notices deliberately omit the referred member's
identity.

## Deployment and rollback

The existing conversational-referral ledger rollout remains a prerequisite and
keeps its original expand/drain/contract order:

1. Keep `HOSTED_USAGE_REFERRALS_ENABLED` unset while the expand-only referral
   schema and entry-keyed grant projection are deployed with compatible Web
   readers and writers.
2. Apply
   `20260728030000_hosted_usage_referral_credit_entry_constraints` while that
   gate remains disabled.
3. Prove the compatible Web deployment is current, wait for the previous Vercel
   function window to drain, then apply the DML-only contract migration
   `20260728031000_resynchronize_hosted_usage_credit_purchase_grants`.
4. Enable `HOSTED_USAGE_REFERRALS_ENABLED=1` only after purchase and grant
   projections converge, then deploy the matching runtime and assistant
   packages.

The stable-link surface is Web-only and schema-free. Deploy the `/r/<token>`
landing page, explicit claim route, authenticated Settings endpoint, runtime
handler, and completion-notice presenter together before sharing stable URLs.
Existing `/join/<inviteCode>` URLs remain compatible.

Keep `HOSTED_SIGNUP_REFERRAL_REWARDS_ENABLED` unset during deployment. Before
enabling it:

1. create and publish the exact production signup-claim WAF rule, set
   `MURPH_SIGNUP_REFERRAL_CLAIM_WAF_RULE_ID`, and require
   `pnpm public-routes:waf-check` to pass against the active configuration;
2. run the count-only 30-day attributed-activation aggregate, explicitly accept
   the bounded backfill population and exposure, and otherwise keep the gate off;
3. confirm exact-head unit, typecheck, app, viewport, and design-proof checks;
4. run the focused local-PostgreSQL concurrent settlement and replay proof,
   including delayed activation after invite expiry and `web` relabeling;
5. smoke one attributed activation and confirm one receipt, entry, grant, member
   balance increment, accurate Settings history, and one identity-safe
   completion notice;
6. replay the activation and recovery pass and confirm no second grant or notice;
7. smoke one cap rejection and one self-referral rejection;
8. exercise the 50-claims-per-hour boundary and confirm the rejected claim
   creates no placeholder member or invite;
9. verify invalid-origin claims remain 403 while known unavailable, busy, and
   temporary dependency-failure paths render human-readable landing states;
   confirm a failed control-root provision leaves no target state and the same
   stable-link retry succeeds after the dependency recovers;
10. switch between two authenticated Settings accounts without a full page
   reload and confirm neither referral action can render or copy the prior
   account's link.

Disabling the signup-reward gate immediately stops new activation scans. It does
not revoke stable links, hide prior history, claw back existing credit, or
suppress a notice for a reward that already committed. Unsettled attributed
activations remain eligible for the bounded backfill but own no cap reservation
and do not pause conversational missions while the gate is off.

Once the first signup-link referral grant exists, Web must not roll back below a
version that understands referral-backed entries and the signup policy version.
Forward-fix or keep this Web head or newer. Rolling back only the public link
route after URLs have been shared would make those stable entry points
unavailable, although already-created `/join/<inviteCode>` descendants remain
ordinary invites.
