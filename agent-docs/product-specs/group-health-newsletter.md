# Group Health Newsletter

Last verified: 2026-08-09
Status: Implemented

## Current State

A member of a Murph group chat (family, friend group, couple, household, team) wants Murph to send a **recurring health newsletter** either in the current iMessage or Telegram group chat or by group email. It celebrates wins, notes standouts, and finds the week's most interesting shared pattern, in a **tone the group picks** (supportive by default; coach-style roast only if the group explicitly asks for it). Setup happens conversationally from inside the group chat: "Murph, set up a weekly health newsletter for us." Murph asks a short setup question set before creating anything: name, schedule, delivery, and optional tone.

For email delivery, the newsletter is **one shared email thread** that the whole group is on, so members can reply-all and banter, and Murph takes part in the thread the way it does in the group chat. For current-chat delivery, it is one ordinary scheduled assistant response on the automation's bound route.

This is a thin feature over primitives that already exist. Group chats are already hosted runtimes with their own vault; members can grant the group access to exact selected health scopes; recurring scheduled sends already exist as automations; and outbound email already ships through the Cloudflare `HOSTED_EMAIL` send binding. Web keeps each bounded health snapshot encrypted on its existing grant row and resolves shared data only when the scheduled model invokes newsletter preparation. The newsletter is a **new consumer** of these primitives plus one new reusable consent grant.

## Product Boundary

The newsletter is not a new scheduler, not a second email system, and not a new personal data store.

- It is one **cron automation living in the group runtime's own vault**, authored the same way reminders are.
- It uses the existing conversation outbox for iMessage and Telegram. Email delivery **reuses** the Cloudflare outbound email path. It does not introduce a parallel sender.
- Linked Telegram group ingress resolves the existing Web-owned thread-container route, appends the message to that container's mailbox with the signed route identity, and lets the ordinary Telegram reply/outbox path deliver current-chat editions. The admitted message also self-heals the container's managed Telegram reply channel if activation is still being processed. A scheduled current-chat edition treats its stored Telegram target only as a hint: Web must bind that exact thread to the synthetic group container before shared reads or model work and again before provider entry. It adds no Telegram-specific newsletter state owner.
- It sends **one shared email to the whole group** (a thread everyone is on), not a personalized email per member. Members reply-all; Murph participates in the thread.
- It **reads only health data that members explicitly share** through the disclosed reaction offer or the join page. Newsletter `prepare` performs the consent-aware Web read after the model invokes the tool; no shared snapshot or destination-local share store is written into the group vault. It does not infer newsletter health access from private 1:1 Murph data.
- Email addresses are **shared with the group by explicit grant** and are visible to co-members in the thread's `To` line — that visibility is the point of a shared reply-all thread and is exactly what the grant authorizes. Addresses are **not persisted in the group vault**; they are resolved web-side at send time and placed only in the outbound email headers.

## Locked Decisions (2026-07-07)

| Decision | Choice |
| --- | --- |
| Who can set up / edit / stop it | **Any member.** One shared automation per group; last-write-wins. |
| Delivery shape | One stable newsletter automation chooses either **one ordinary current-chat update** or **one shared email thread** to all eligible participants. |
| Email permission | Included in the disclosed newsletter reaction-share scope and on the join page as **"share your email with this group."** The shared thread exposes addresses to co-members by design. |
| Newsletter content opt-in | Liking the newsletter permission offer opts into the disclosed default snapshot: profile name, email, sleep duration, activity minutes, workout summaries, resting heart rate, and HRV. It grants membership only when needed; the customize link lets a member share more or less. |
| New-group requested permissions | Murph requests and initially selects every selectable group permission by default, including activity-specific selector scopes, so the consent checkpoint is complete. This does **not** grant access: each member still opts in through the disclosed reaction or join page and may deselect any permission. An explicitly supplied narrower scope list remains narrow. |
| Setup flow | **Ask before creating.** Murph asks for the name, schedule, and email-versus-chat delivery in one short message, with tone optional. If the group already answered or says "just set it up," Murph uses sensible defaults and confirms the essentials. |
| Naming | The **group-chosen name** becomes the automation title, the group display name when a group join link is created, and the name in the setup notice. |
| Individual opt-out | **Revoke email sharing** through settings, an authenticated Linq/iMessage or Telegram group message, or a private Murph chat. Email headers do not prove the sender's self-revocation authority. Leaves challenge/health-sharing intact. Forward-only. |
| First send | **Announced in the group with a short opt-out window.** Never a silent immediate first fire. |
| No-email-yet member | Grants email permission at join anyway; **auto-joins** once they add + verify an email later. |
| Tone | **Supportive by default, never shaming.** Coach-style roast only on explicit group opt-in ("be hard on us"). Optional custom note. |
| Access gating | **Free for every group.** No entitlement checks. |
| Cadence | Weekly default (Sunday morning local), natural-language configurable, per-group jitter. |
| Chat delivery | The same `group-health-newsletter` automation uses a system-owned delivery tag. Current-chat runs use one bounded `read_shared` for at most three configured scopes plus the ordinary conversation outbox and receive no newsletter email-send authority. The default scopes are steps, workout details, and sleep duration so same-week activity context is available when shared. |
| Permission offers | In iMessage/Linq, Web renders one natural Murph consent message from the frozen server-owned scope description and first-party URL, sends that consent target as one reaction-bound provider message, and treats a freshly posted native offer as Murph's complete reply. Model-authored prose cannot redefine what an affirmative reaction means or add another link. In Telegram, return the existing Web-owned join URL in the ordinary chat reply because Telegram has no provider reaction-offer path. |
| Consent invariant | The offer message and stored grant snapshot must match: `HostedGroupJoinOffer.projectionKindsJson` is the frozen server-side snapshot, and the Web-owned scope sentence renders from that same projection list. |
| Health data toggles | The newsletter default scope includes the named health fields above. Members can narrow or widen it with the customize link. |
| Projection retention | Each Web-owned encrypted health snapshot can carry **the 8 most recent records per projection kind** and replaces the prior snapshot on that exact active grant row. This retains the open local date plus the seven prior completed dates without exposing older history. The signed callback body ceiling is 19 KiB: above the maximum legal eight-record workout payload and below the equivalent nine-record payload. |

## Canonical Objects

### Email-sharing grant — the one new primitive

A new reusable vault-share grant kind, e.g. `group-email.v0`, added to `HOSTED_VAULT_SHARE_PROJECTION_KINDS` and `HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS` in `packages/hosted-execution/src/vault-share.ts`, with a display label in `apps/web/src/lib/hosted-groups/join-policy.ts`.

Semantics: **"share my email with this group."** It authorizes Murph to put the member on the shared newsletter thread, where their address is visible to co-members (as in any group email). The address is **not** delivered into the group vault; it is resolved web-side at send time by member id and placed only in the outbound email headers.

There is deliberately **no separate "newsletter" permission.** Email sharing is the single toggle: if a member granted it, they are on the newsletter thread, and if they don't want it, they revoke it. Layering a newsletter-specific consent on top of email sharing would be redundant granularity.

It rides the existing `HostedVaultShare` table (`apps/web/prisma/schema.prisma`) and grant/revoke control plane (`apps/web/src/lib/hosted-vault-share/share-grant-store.ts`). No schema migration is required beyond registering the kind. Grant caps apply as-is.

At group creation, every selectable projection is **initially requested and
selected at the consent checkpoint**, including activity-specific selector
scopes. This includes workout summaries and workout details so a later weekly
update can explain a movement number with observed same-period training context
when available. Nothing is silently granted: the reaction or join page remains
the consent gate, and each member can deselect any requested permission before
granting it. A comprehensive checkpoint provides one clear-all action so joining
without optional health or email sharing does not require dozens of individual
mutations; members can re-enable exact choices before submitting. When Murph
supplies an explicit narrower scope list, the server
preserves that exact narrow request, including an aggregate Deep or REM sleep
scope. Only the omitted comprehensive default collapses each aggregate and
source-aware sleep pair to the single source-aware permission. A new consent
checkpoint replaces the group's prior requested policy instead of unioning it,
revokes stale unaccepted offers, and reuses an active native offer only when its
frozen scopes match exactly. This replacement changes requested consent only;
it does not revoke permissions that members already granted. When an existing
member reopens the join page, the editable list is the union of the current request and every
permission that member still actively shares with the group, so a narrower
future request cannot hide an older grant from the member's revoke controls.
New invitees see only the current requested checkpoint.

For native reaction offers, Web supplies the only URL and the fixed affirmative
reaction meaning. The rendered prompt is sent as one reaction-bound provider
text message, so the stored consent target is the same bubble the member reads
and reacts to.

Each requested-permission policy carries one opaque offer generation in the
existing join-policy JSON. Creation, legacy-policy backfill, and every exact
scope-set replacement mint a new generation; a retry of the same current policy
keeps it. Native offer preparation freezes both the generation and normalized
scope set, the provider idempotency key includes the generation, and the later
binding transaction locks the group row and rechecks both values. Therefore a
late provider completion from an older policy cannot become the active consent
target, including an A-to-B-to-A scope sequence. This uses no new table, queue,
or recovery owner.

Channel fallback adapters preserve whether a projection array was supplied.
An explicit empty scope or kind array remains empty through Web; only omission
selects the complete default permission set and canonicalizes its duplicate
aggregate/source-aware sleep pairs. This distinction applies equally to native
offers and standalone join links.

### Newsletter automation — the schedule + config

A cron automation persisted in the **group runtime's** vault (`bank/automations/<id>.md`), modeled on the existing `weekly-health-digest` managed automation (`packages/assistant-engine/src/assistant/managed-automations.ts`). Schema in `packages/contracts/src/automation.ts`.

- `schedule: { kind: 'cron', expression: '0 9 * * 0' }` (Sunday 09:00 default; timezone = vault timezone). Weekly uses `cron`, never `every` (which drifts across DST/missed wakes).
- `continuityPolicy: 'fresh'` (a standalone digest).
- Setup uses the structured `murph.automation action="save_newsletter"` action. It writes canonical configuration text plus exactly one system-owned delivery tag: `system:group-newsletter:current-chat` or `system:group-newsletter:email`. The model does not author operational instructions, the slug, or reserved tags.
- Newsletter configuration or route changes repeat that structured save from the destination group; generic patch is status-only.
- Name, exact scopes, tone flavor, delivery, and optional custom note live in the automation's **instruction text** — no new config table. This satisfies the persisted-state placement gate: an automation is already a canonical vault record and is the group-scoped source of truth for the newsletter.
- One automation per group. "Any member can edit" = any member's in-chat request upserts/patches that single record (last-write-wins). `status: paused` stops it.
- **First run after creation or delivery/configuration re-save is not immediate.** Murph posts a group notice and email send authority is withheld until the opt-out window measured from the automation's latest `updatedAt` has elapsed (see Security & Abuse).

### Participants and featured set

Derived at send time, not persisted:

```
authorized = group roster ∩ members who granted group-email.v0
recipients = authorized ∩ members with a resolvable verified email
featured   = recipients ∩ members with a consented completed-day health stat
```

The single shared email is sent to all **recipients** (`To`: all recipient
addresses). Its body uses health data only from the **featured** members plus
eligible group comparisons. The trusted Web-side newsletter `prepare` call
returns member ids, email eligibility, and an address-free snapshot of each
member's current data grants as exact projection-scope/share-id pairs, plus a
SHA-256 proof of the complete private participant snapshot, including a hashed
verified-email lookup identity that is never shown to the model.

This preparation starts only after the model invokes
`murph.newsletter action="prepare"`. Trusted assistant code then requests the
email-eligible health scopes through the direct Web shared-data reader. Each
read captures the current roster and exact active grants, decrypts the bounded
Web-owned snapshots on those grant rows, and derives device connection status
live only when `device-sync-status.v0` is currently granted. The runtime uses
the group vault timezone to turn the returned records into facts from the seven
completed local calendar days before the occurrence
and exposes only email-eligible results to the model. No roster, grant,
snapshot, device, filesystem, projection, or Web/network read occurs before the
model turn starts, and no shared-data copy lands in the destination workspace.
Revocation clears its encrypted snapshot in the same Web authority transaction;
the read path does not depend on asynchronous cleanup. The model never performs
the authorization join and receives neither the grant snapshot nor its proof.

Newsletter cron turns keep the normal group conversation thread, native resume
behavior, and shell/tool access. The runtime appends the current execution
contract to the saved configuration on every run, so legacy records receive the
current workflow without mutating their persisted instructions. Email runs use
only the filtered `prepare.result.members` facts; current-chat runs use one
bounded `read_shared` for the exact saved scopes. This is an assistant
instruction, not a provenance guarantee: conversation or tool context can still
be visible to the model. The hard boundary is the late authorization proof,
which constrains current preparation and recipients but does not prove that
every model-authored sentence came only from the latest preparation.

For a scheduled Telegram group current-chat run, the saved target cannot open
that shared-read boundary by itself. Before exposing `read_shared` or starting
the model, the runtime obtains an exact `{ channel, containerMemberId, threadId
}` assertion from the signed Web route owner. It carries that assertion on the
ordinary outbox intent and rechecks the same owner immediately before Telegram
provider entry. Missing ownership is retryable and changed ownership blocks the
send, so composition from one group cannot be redirected to another thread.

Each scheduled turn owns a one-shot capability: exactly one preparation
attempt and at most one send attempt. Any failure or send closes it, so a model
cannot compose from one snapshot, refresh the proof, and reuse the older body.
Send persists the HTML body and address-free proof on a parent intent in the
existing assistant outbox; it never calls the provider from the tool. The
existing hosted group fanout planner revalidates the proof, persists one child
intent per authorized recipient before provider entry, and then sends each child
with one envelope recipient while preserving the full authorized `To` audience
in the shared MIME. The parent carries the automation id plus expected
configuration revision, and every fanout child copies that same
authority. Editing, switching delivery, pausing, or archiving the automation
therefore invalidates already-queued work before provider entry. Legacy parent
intents without revision authority remain readable for compatible retry
handling. No new queue, table, route, scheduler, or state owner exists.

The parent and children share the occurrence-scoped delivery key. Once the
outbox accepts the parent, it reports that id to cron immediately. Cron stores
the id in its existing `delivery_pending` state and stops model work for the
occurrence even if provider completion, decision validation, or turn
persistence later fails; the run record retains that post-acceptance error. If
the process stops between durable parent creation and that cron write, the next
run derives the same parent from the occurrence-scoped outbox key before model
admission and reconnects it to `delivery_pending`; no repair queue or second
owner is involved.
Web marks the parent sent only after it has revalidated the proof and durably
persisted the recipient fanout intents. The existing deterministic cron
reconciler then settles the occurrence from that parent state; it never starts
another model turn to inspect or recreate recipient work. Each child stays with
the generic outbox's bounded retry lifecycle, and terminal child failure does
not gain a fresh budget or body through newsletter-specific replay. Missing
prepare/send results and unavailable preparation before parent acceptance are
explicit retryable model-turn failures.
The first-run opt-out window remains separate and supplies no scheduled send
authority, so it can still consume its intentional no-send occurrence.
Immediately before MIME construction and each recipient provider entry, the web
callback resolves the complete canonical snapshot again and returns addresses
only when its proof matches.

## Content and Tone

### Data source

Whatever the member consented to share with the group, no more. After the model
invokes newsletter `prepare`, trusted runtime code requests the eligible exact
scopes through the direct Web shared-data reader. Web resolves current active
grants, decrypts their bounded encrypted snapshots, and returns the complete
member/scope result; an explicitly consented device status is derived live
rather than stored in a snapshot. `buildSharedGroupWeeklyMembers`
(`packages/query/src/group-weekly.ts`) turns available records into per-member
summaries over the seven completed local calendar days before the scheduled
occurrence. Each encrypted health snapshot carries up to eight records per
projection kind: the open local date plus the seven prior completed dates.
Projection reads use a calendar-date cutoff rather than a rolling-hour cutoff,
so timezone offset and time of day cannot discard the oldest required date.
That bounded projection cannot also prove a complete prior calendar week, so
the result deliberately omits prior-week averages and deltas.
One shared body; everyone on the thread sees the same digest.

Default content is a selective weekly story, not one repeated metric block per
featured member. Lead with the strongest close race, leader, surprising
combination, or recent group pattern; use the returned stats that develop
that story. Cross-person comparisons may include exercise, movement, steps,
sleep duration, sleep timing, consistency, and other consented group
metrics. Do not rank "healthiest person" or default to raw biomarker
leaderboards; use HRV, resting heart rate, weight, symptoms, and similar
context-dependent measures mainly for group-level patterns unless the group
explicitly chose that challenge metric.

When a standout number has directly observed behavior from the same member and
period, pair the two: for example, describe high steps alongside the returned
workout count, duration, or type. Use association language such as "alongside,"
"with," or "during"; never invent a workout type or claim the behavior caused
the metric. If the authorized result has no such context, state the number
plainly instead of guessing.

For group-email preparation, authorized `workouts.v0` days become
kind-specific count and minute streams in the existing weekly-stat shape. Each
value is an average across the returned `observedDates`, which include only
dates inside the seven-completed-day window and no date after the workout
projection's completion watermark. The reducer aggregates multiple same-kind
workouts on one date before averaging, omits `startLocalMs`, and never exposes a
raw workout event list. These values can support truthful phrasing such as
"alongside running on three observed days"; they do not support multiplying an
average into a weekly workout or minute total. Current-chat delivery keeps its
existing compact day-by-day workout representation.

Express durations in human units. Use "about 30 minutes of movement a day"
instead of raw minute totals when the returned fact's semantic owner identifies
the value as broad movement. New `activity-days.v0` producers mark that value
as `"broad-movement"`, while new `workout-days.v0` producers mark their
canonical combined rollup as `"canonical-workout-day"`. Distinct same-day
workouts add in that rollup, while mirrored copies count once; consumers never
repair a value by replacing one workout with another or summing raw records
independently.

The marker rollout is producer-first. During its bounded compatibility phase,
the weekly reader still accepts unmarked legacy rows so existing groups do not
lose data before their snapshots are refreshed. Deploy the marker-preserving
Web parser before the marker-producing runner, refresh every current grantor
through the existing maintenance wake, and prove the legacy population has
drained. Exact-marker rejection belongs to the subsequent consumer release,
not this compatibility phase.

Newsletter `prepare` excludes the open local calendar day from every average
and includes only the seven local calendar days before it. Each returned stat
reports `completedDaysAvg`, `observedDayCount`, sorted `observedDates`, and
`throughDate`; scope the claim to those observed completed days, and do not
infer that unobserved days were zero or that the full window is represented.
A settled cross-person leader, winner, or crown for a metric requires identical
`observedDates` across every compared member. When coverage differs, scope each
average to its own dates and avoid a crown. For current-chat raw records, derive
the equivalent sorted usable date set from the seven local calendar days before
today after semantic validation. Exclude both the current local day and older
records from the rolling read window. Apply the same identical-date rule.
A current-day value may appear only as a separate, explicit "today so far"
aside, never as input to a weekly leader, crown, or challenge. This group-level
qualifier is not a member-specific missing-data callout.

Neither weekly payload supports an inferred weekly total, so never multiply an
average into a weekly sum. The current `workout-count` average omits
zero-workout days, so it
cannot support weekly workout totals or workout-count rankings. The payload
also cannot support prior-week change, monthly highs, or four-week highs. Call
genuinely broad activity "movement" and reserve "exercise" for
workout/exercise sources. A normal rich edition may use roughly 6–12 useful
stats, but every number should establish a leader, race, surprise, or recent
group pattern instead of merely proving the field was
available. Omit member-specific missing-data callouts. Build the featured set only from
participants with a verified email and at least one completed-day stat; do not
use any other participant's health data in the subject or body.
When no usable stats are returned, state only that fact; never speculate that
sync or permission failures caused it.

### Tone

- **Supportive by default** (never shaming, no purity/moralizing language, consistent with the global Murph persona). Because it is one shared email, any individual "focus area" is public within the group, so keep it constructive, sparse, and never demeaning; prefer aggregate framing ("the group's sleep slipped this week") over singling out the worst performer.
- **Coach-style roast only on explicit group opt-in** — the group asks Murph to "be hard on us like a coach." Even then it punches **upward** (the organizer, the loudest, the confident), stays about the effort/challenge and never the body, per the existing `group-chat/SKILL.md` guardrails.
- Optional free-text custom note tunes the vibe.

## Delivery

### Transport — reuse `HOSTED_EMAIL`

Outbound goes through the existing Cloudflare `send_email` binding `HOSTED_EMAIL` (`apps/cloudflare/wrangler.jsonc`) via `sendHostedEmailMessage` (`apps/cloudflare/src/hosted-email/transport.ts`), executed by the runner-outbound handler (`apps/cloudflare/src/runner-outbound/results.ts`). Cloudflare Email Service delivers to arbitrary recipients once a sending domain is onboarded. Domain onboarding is an **ops preflight item** (verify in the Cloudflare dashboard before launch; it is not provable from source). The `EmailMessage` payload is raw MIME, so HTML parts are supported. Free tier is 3,000 sends/month, then $0.35/1,000.

### Shared thread

The newsletter is one message the whole group is on:

- The MIME `To` header lists **all participant addresses**; the message carries a stable `Message-ID`, an occurrence-seeded `Date`, and `References` for replies so it threads.
- The binding sends one envelope copy per participant (per-recipient RCPT) with identical MIME. Each recipient sees the same thread; **reply-all** reaches the other members via `To` and the group's Murph via `Reply-To`.
- HTML body (add an HTML alternative part to the outbound builder, which is text-only today).
- **`From`** = the configured hosted sender address (main's existing convention); **`Reply-To`** = the group runtime's signed reply alias, so replies land back in the group's Murph. **Murph participates in the thread** — inbound replies route through the existing hosted-email ingress (`apps/cloudflare/src/hosted-email/worker-ingress.ts`) into the group runtime, so Murph reacts/answers like it does in the group chat.
- A **new thread per weekly edition** (each week stands alone; avoids one ever-growing chain).

### Address resolution

The participant address list is assembled **web-side at send time** from members who granted `group-email.v0` (`readHostedMemberEmailAuthorization`, `apps/web/src/lib/hosted-onboarding/hosted-member-store.ts`). Addresses live only in the outbound headers, never in the group vault.

### No-email-yet member

Grant and address are decoupled: a member grants email permission at join even
with **no verified email**. At each run, a participant with no resolvable
address is **skipped for now** and Murph posts one nudge in that member's own
private Murph thread with
`https://www.withmurph.ai/settings?addEmail=true`. When they add + verify an
email (existing Privy → `/api/settings/email/sync` flow), the **next edition
includes them automatically**. The `?addEmail=true` deep-link is a small web
addition (copy the `home`/`connect` searchParams pattern; the settings dialog
already auto-routes headless-vs-Privy-modal).

## Opt-out

Individual and self-service. A member says "take me off the newsletter" **in the group chat**; Murph calls `murph.group action="revoke_own_email_share"` with the opaque `message_ref` beside that exact accepted request. The host reloads the message, derives its authenticated provider sender, and Web resolves the canonical member before revoking **only that member's own** `group-email.v0` grant. Missing or unattributed sender evidence fails the revocation without blocking the normal group reply. An **email-thread reply cannot revoke**: the email `From` header is unauthenticated and spoofable, so email-sourced opt-out fails closed and Murph instead directs the member to the group chat or settings. For the same reason, an email-thread reply may converse and read current group context but cannot create, edit, import, pause, or reactivate automations or mutate group join links/offers, display name, avatar, or contact-card state; those controls require the authenticated group chat. Revoking removes them from the thread and from being featured, while their challenge/health-sharing (a separate grant) stays intact. Opt-out is **forward-only** — editions already delivered are already in inboxes.

## Security & Abuse

- **Join is the consent gate.** Only members who (a) have a Murph account, (b) accepted this group's join link themselves or reacted to a disclosed server-owned offer, (c) granted email sharing, (d) granted any health projections the newsletter uses, and (e) have a verified email can be on the newsletter. Adding phone numbers to an iMessage group grants none of this — **you cannot enroll non-participants**, so there is no "blast a group of strangers" vector.
- **Residual risk.** In a group people *have* joined, any member (per any-member setup) can create a newsletter that would immediately broadcast every participant's **email address** (visible thread) and **health summary** to the whole group. Email-sharing default-on amplifies this; the first send is an **irreversible exposure**; an immediate fire leaves no chance to opt out.
- **Mitigation — announce + opt-out window before the first send.** Newsletter creation posts a clear group notice and the **first edition does not fire immediately or silently**; it respects a short opt-out window so every participant can decline before any exposure. Owner-only setup would not help (an attacker can be the owner), so the notice window is the control regardless of setup rights.
- **Address visibility is by design** (shared reply-all thread) and authorized by the grant; consent copy must say plainly that the email is shared *with the group*. If in-group address privacy is ever required, the listserv/group-alias model hides addresses behind one group address (bigger build — see Open Items).
- **Group-thread reply sender identity** uses the same web-owned `From`-address matching as the existing public-sender email lane; `From` spoofing is a shared, accepted residual of that model, with platform-level DKIM verification deferred because Cloudflare does not reliably expose `Authentication-Results` to Workers today.
- **Health-data posture.** The disclosed reaction offer or join page is the health-sharing consent checkpoint. The announce + opt-out window is an additional protection before the first irreversible email exposure, not a substitute for grant disclosure. Review consent copy against `apps/web/src/lib/legal/consent.ts` and the FTC HBNR compliance docs before launch.
- **Newsletter composition boundary.** Scheduled newsletter composition keeps
  the normal group conversation and tools, while its instructions restrict the
  edition's health facts to `prepare.result.members`. The runtime filters that
  result by current email eligibility and exact active grants resolved by the
  model-triggered direct Web read. Send requires a matching
  same-occurrence preparation and carries its address-free proof to the final
  web callback, which rechecks the complete authorization snapshot before
  provider entry, so
  revoked recipients cannot receive the already-composed email. This proof does
  not establish model-content provenance. Before a sent parent
  exists, a proof mismatch prevents provider entry and the occurrence remains
  retryable through the outbox lifecycle. After a parent is sent, a later proof
  mismatch is terminal for that occurrence, and safe recipient retries copy the
  sent parent payload rather than composing a second body under the same message
  identity. Transient runtime unavailability remains retryable. When preparation
  finds no email-eligible participant, trusted runtime code records the
  terminal `no_recipients` result and closes send authority while the model
  returns the documented group settings reminder.
- **Current-chat route coupling.** Scheduled Telegram group composition cannot
  read shared facts until Web proves that the stored thread still belongs to
  the executing synthetic group container. The same exact authority must reach
  the ordinary outbox and pass a live Web recheck at provider entry. Route-owner
  unavailability or reassignment fails without sending to a replacement chat.

## The Skill

The dedicated `group-newsletter` assistant skill owns the editorial story,
human-readable units, comparison rules, email subject, tone, calibrated
examples, and final edition. The `group-chat` skill owns the room-level setup
questions, group-chosen name and schedule, email-share offer,
announce-before-first-send behavior, and opt-out handling. The structured setup
action writes configuration only; the runtime appends the current execution
contract on each scheduled turn. Skills carry no durable state; state lives in
the automation and grants.

## Net-New Surface (summary)

1. `group-email.v0` grant kind + join-policy display + disclosed newsletter reaction-share scope + "shared with the group" consent copy.
2. Group-send path in the hosted-email transport: assemble the participant address list web-side, build one shared MIME (`To`: all, stable `Message-ID`/`References`), HTML body, send one envelope copy per participant.
3. A direct, model-triggered Web shared-data reader over exact active grants,
   bounded encrypted grant-row snapshots, and live explicitly consented device
   status. The reusable seven-completed-day summary builder lives in
   `packages/query`; trusted newsletter preparation calls it without
   destination-local share state.
4. `group-newsletter` skill + one structured newsletter save action over the existing automation port (group-chosen name as title, schedule as cron, delivery tag, scopes and tone in configuration text), including setup questions, ordinary current-chat delivery, announce-before-first-email + opt-out window, normal group conversation/tool continuity during scheduled composition, and Murph taking part in email-thread replies via the existing inbound ingress.
5. Complete replacement of each Web-owned encrypted health snapshot, bounded to the latest eight records per projection kind (the open local date plus seven prior completed dates).
6. `?addEmail=true` settings deep-link + private missing-email reminder through the member's own Murph.

Everything else is reuse: scheduling, current-chat outbox, health projections, rollup engine, roster, grant plumbing, tone guardrails, outbound email transport, inbound email ingress.

## Open Items / Future Work

- **Listserv / hidden-address model**: a per-group email alias that hides individual addresses behind one group address, as a privacy upgrade over the visible-address MVP.
- **Murph's email-thread depth**: starts as full participation (reacts/answers like the group chat); tune verbosity so it does not over-reply.
- **Catch-up send**: optionally email the latest edition immediately when a pending member first verifies an email, instead of waiting for the next cycle.
- **Group-scoped web config surface**: if a future web UI must show/manage newsletter settings, promote config from the automation instruction text to a `HostedGroup` JSON blob + a `murph.group` write action. Not needed for MVP.
- **Operational**: confirm the ~3k/month Cloudflare free tier is comfortable; jitter weekly sends; pick the from-name ("Murph" vs "Murph — [Group]"); decide which timezone "Sunday 9am" means for a distributed group.
- **Consent review**: copy + flow against `consent.ts` and FTC HBNR posture.

## Deployment Concerns

The hosted newsletter callback accepts only `prepare` and `send`. Every
successful `prepare` returns the address-free live grant snapshot plus its
SHA-256 proof. The model-facing schema exposes the same two actions, while the
proof and HTML stay in trusted outbox/effect state. The signed, member-bound
callback, live membership and grant resolution, exact share-id/scope filtering,
and proof-required delivery revalidation remain the authorization boundary; the
retired request-version negotiation did not contribute authority.

For the route-derivation and delivery-choice change, deploy Vercel/web first,
then deploy the Cloudflare/runner bundle with `container_rollout=immediate`.
The new Web consumer accepts the old optional `groupId` field but ignores it and
derives the one group from the signed runtime member. The new runner omits that
redundant model-controlled field. This makes the skew window compatible in the
forward direction; roll back the runner before Web. After both are live, run
one preparation call and confirm the trusted web wire contains
only member ids, email eligibility, and address-free share ids/scope keys, while
the model-facing runner result contains only the authorized completed-day facts
and no raw email addresses or grant metadata. Confirm a scheduled send first
persists the existing-outbox parent and recipient children, re-resolves the
current authorization snapshot, fails closed when either recipients or health
grants change after preparation, records the accepted parent as the cron
occurrence's existing pending-delivery intent, and settles that occurrence when
Web marks the parent terminal without rerunning the model.

The base newsletter change spans **Cloudflare** (`apps/cloudflare`: HTML MIME, group-send path, address-resolution callback, inbound thread participation) and **Vercel/web** (`apps/web`: `group-email.v0` display + default request, address-resolution endpoint, `?addEmail=true`). Safe deploy order is **web first, then Cloudflare** — the web resolution endpoint and the new grant kind must exist before the Worker calls them. Both sides must recognize `group-email.v0` during the window.

The private missing-email nudge subfeature spans **Vercel/web** (`apps/web`: appends `group-newsletter.email-needed` mailbox wakes with a per-wake `directRoute`) and the hosted runner bundle (`packages/assistant-runtime`: imports that wake into a private direct conversation). Safe deploy order is **Cloudflare/runner first with `container_rollout=immediate`, then Vercel/web**. Gradual rollout with warm old runner containers is unsafe after the web producer is enabled: an old runner can import a direct-route-dependent wake as `group-newsletter.email-needed.no-direct-route`, advance the mailbox lane watermark, and spend the once-ever nudge key. The compatible runner behavior is that no-route newsletter nudges are retryable/deferred and do not advance mailbox import progress. The rollback floor after web deploy is the runner bundle that understands wake-level `directRoute` and defers no-route newsletter imports; do not roll Cloudflare below that floor unless the web producer is reverted or disabled first. Post-deploy check: enqueue or observe one missing-email nudge with `directRoute` and confirm the runtime records `group-newsletter.email-needed.staged` rather than `group-newsletter.email-needed.no-direct-route`.
