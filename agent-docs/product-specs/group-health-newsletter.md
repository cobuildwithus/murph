# Group Health Newsletter

Last verified: 2026-07-14
Status: Implemented

## Current State

A member of a Murph group chat (family, friend group, couple, household, team) wants Murph to send a **recurring health newsletter by email** to the group. It celebrates wins, notes standouts, and gently nudges laggards, in a **tone the group picks** (supportive by default; coach-style roast only if the group explicitly asks for it). Setup happens conversationally from inside the group chat: "Murph, set up a weekly health newsletter for us." Murph asks a short setup question set before creating anything: name, schedule, email versus chat delivery, and optional tone.

The newsletter is delivered as **one shared email thread** that the whole group is on, so members can reply-all and banter, and Murph takes part in the thread the way it does in the group chat.

This is a thin feature over primitives that already exist. Group chats are already hosted runtimes with their own vault; members can share selected health metrics into that vault through disclosed grants; recurring scheduled sends already exist as automations; and outbound email already ships through the Cloudflare `HOSTED_EMAIL` send binding. The newsletter is a **new consumer** of these primitives plus one new reusable consent grant.

## Product Boundary

The newsletter is not a new scheduler, not a second email system, and not a new personal data store.

- It is one **cron automation living in the group runtime's own vault**, authored the same way reminders are.
- It **reuses** the Cloudflare outbound email path. It does not introduce a parallel Resend broadcast sender (Resend stays for web transactional mail only).
- It sends **one shared email to the whole group** (a thread everyone is on), not a personalized email per member. Members reply-all; Murph participates in the thread.
- It **reads health data that members explicitly share** into the group vault through the disclosed reaction offer or the join page. It does not infer newsletter health access from private 1:1 Murph data.
- Email addresses are **shared with the group by explicit grant** and are visible to co-members in the thread's `To` line — that visibility is the point of a shared reply-all thread and is exactly what the grant authorizes. Addresses are **not persisted in the group vault**; they are resolved web-side at send time and placed only in the outbound email headers.

## Locked Decisions (2026-07-07)

| Decision | Choice |
| --- | --- |
| Who can set up / edit / stop it | **Any member.** One shared automation per group; last-write-wins. |
| Delivery shape | **One shared email thread** to all participants; addresses visible; reply-all; Murph present in-thread; a new thread each week. |
| Email permission | Included in the disclosed newsletter reaction-share scope and on the join page as **"share your email with this group."** The shared thread exposes addresses to co-members by design. |
| Newsletter content opt-in | A reaction to the newsletter join offer grants the disclosed default scope: profile name, email, sleep timing, activity minutes, workout summaries, resting heart rate, and HRV. The customize link lets a member share more or less. |
| Setup flow | **Ask before creating.** Murph asks for the name, schedule, and email-versus-chat delivery in one short message, with tone optional. If the group already answered or says "just set it up," Murph uses sensible defaults and confirms the essentials. |
| Naming | The **group-chosen name** becomes the automation title, the group display name when a group join link is created, and the name in the setup notice. |
| Individual opt-out | **Revoke email sharing** (self-service, in chat or by replying in the thread). Leaves challenge/health-sharing intact. Forward-only. |
| First send | **Announced in the group with a short opt-out window.** Never a silent immediate first fire. |
| No-email-yet member | Grants email permission at join anyway; **auto-joins** once they add + verify an email later. |
| Tone | **Supportive by default, never shaming.** Coach-style roast only on explicit group opt-in ("be hard on us"). Optional custom note. |
| Access gating | **Free for every group.** No entitlement checks. |
| Cadence | Weekly default (Sunday morning local), natural-language configurable, per-group jitter. |
| Chat delivery | If the group wants delivery in the group chat, use a normal scheduled group-chat update automation. The `group-health-newsletter` slug and email machinery are only for email delivery. |
| Join offers | Lead with **react to this message to join**, state the exact `{{share_scope}}`, and include the customize link. Reacting grants the disclosed snapshot; the link is the fine-tune path. |
| Consent invariant | The offer message and stored grant snapshot must match: `HostedGroupJoinOffer.projectionKindsJson` is the frozen server-side snapshot, and `{{share_scope}}` must render from that same projection list. |
| Health data toggles | The newsletter default scope includes the named health fields above. Members can narrow or widen it with the customize link before joining. |
| Projection retention | Each vault-share delivery can carry **the 7 most recent records per projection kind**, matching count-based receiver retention. |

## Canonical Objects

### Email-sharing grant — the one new primitive

A new reusable vault-share grant kind, e.g. `group-email.v0`, added to `HOSTED_VAULT_SHARE_PROJECTION_KINDS` and `HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS` in `packages/hosted-execution/src/vault-share.ts`, with a display label in `apps/web/src/lib/hosted-groups/join-policy.ts`.

Semantics: **"share my email with this group."** It authorizes Murph to put the member on the shared newsletter thread, where their address is visible to co-members (as in any group email). The address is **not** delivered into the group vault; it is resolved web-side at send time by member id and placed only in the outbound email headers.

There is deliberately **no separate "newsletter" permission.** Email sharing is the single toggle: if a member granted it, they are on the newsletter thread, and if they don't want it, they revoke it. Layering a newsletter-specific consent on top of email sharing would be redundant granularity.

It rides the existing `HostedVaultShare` table (`apps/web/prisma/schema.prisma`) and grant/revoke control plane (`apps/web/src/lib/hosted-vault-share/share-grant-store.ts`). No schema migration is required beyond registering the kind. Grant caps apply as-is.

It is **default-checked at group creation**: this feature introduces default-requested projections (previously group creation seeded none — callers passed an explicit list), adding `group-email.v0` to the group's `joinPolicyJson` requested set at creation (`apps/web/src/lib/hosted-groups/group-store.ts` / `join-policy.ts`) so any new group collects email permission up front. A member can uncheck it at join to decline. Because email is collected at join, setting up a newsletter later requires **no re-approval**.

### Newsletter automation — the schedule + config

A cron automation persisted in the **group runtime's** vault (`bank/automations/<id>.md`), modeled on the existing `weekly-health-digest` managed automation (`packages/assistant-engine/src/assistant/managed-automations.ts`). Schema in `packages/contracts/src/automation.ts`.

- `schedule: { kind: 'cron', expression: '0 9 * * 0' }` (Sunday 09:00 default; timezone = vault timezone). Weekly uses `cron`, never `every` (which drifts across DST/missed wakes).
- `continuityPolicy: 'fresh'` (a standalone digest).
- Tone flavor + optional custom note live in the automation's **instruction text** — no new config table. This satisfies the persisted-state placement gate: an automation is already a canonical vault record and is the group-scoped source of truth for the newsletter.
- One automation per group. "Any member can edit" = any member's in-chat request upserts/patches that single record (last-write-wins). `status: paused` stops it.
- **First run after creation is not immediate.** When the newsletter is created, Murph posts a group notice and the first edition respects an opt-out window (see Security & Abuse).

### Participants and featured set

Derived at send time, not persisted:

```
authorized = group roster ∩ members who granted group-email.v0
recipients = authorized ∩ members with a resolvable verified email
featured   = recipients ∩ members with a consented current weekly health stat
```

The single shared email is sent to all **recipients** (`To`: all recipient
addresses). Its body uses health data only from the **featured** members plus
eligible group comparisons. The trusted web-side newsletter `prepare` call
returns member ids, email eligibility, and an address-free snapshot of each
member's current data grants as exact projection-scope/share-id pairs, plus a
SHA-256 proof of the complete private participant snapshot, including a hashed
verified-email lookup identity that is never shown to the model. Trusted
assistant code loads the same generic group weekly projection and vault timezone
used by `vault-cli group weekly` **before** the final web authorization request.
That final web resolution derives group binding, membership, active access,
verified-email identity, and every grant from one late repeatable-read database
snapshot. After it returns, assistant code synchronously filters the
already-loaded projection by the exact live pairs and serializes current-week
facts only for email-eligible members. This ordering remains safe while
asynchronous revoke cleanup is still in flight: a stale local record's old
share id no longer matches the final canonical grant result. The model never
performs the authorization join and receives neither the grant snapshot nor its
proof.

Authorized newsletter cron turns use an isolated thread with native resume
disabled, run without the Codex shell tool, and receive the newsletter skill
in trusted system context. They therefore cannot inherit old group facts from
committed transcript replay or bypass the filtered result with the unfiltered
generic CLI reader. Ordinary group-chat turns retain their normal conversation
thread and generic reader.

Each isolated scheduled turn owns a one-shot capability: exactly one preparation
attempt and at most one send attempt. Any failure or send closes it, so a model
cannot compose from one snapshot, refresh the proof, and reuse the older body.
Send persists the HTML body and address-free proof on a parent intent in the
existing assistant outbox; it never calls the provider from the tool. The
existing hosted group fanout planner revalidates the proof, persists one child
intent per authorized recipient before provider entry, and then sends each child
with one envelope recipient while preserving the full authorized `To` audience
in the shared MIME. No new queue, table, route, scheduler, or state owner exists.

The parent and children share the occurrence-scoped delivery key. A later fresh
cron turn reads their durable states: active work returns `accepted` and retains
the occurrence; all-sent or durably classified partial work is terminal. Once a
parent intent has been sent, that parent's subject, text, HTML, proof, and
occurrence identity are the immutable manifest for the occurrence. Safe
pre-provider recipient failures may create new child intents, but those children
copy the sent parent manifest instead of re-planning from a fresh model body.
The sent parent manifest and terminal recipient evidence for the occurrence are
retained outside normal terminal outbox pruning because canonical cron
completion may need to replay after long downtime before it can mark the
occurrence terminal. Sent and ambiguous children are never replayed, and a
changed proof after a sent parent is terminal for that occurrence instead of
authorizing a second payload under the same message identity. Missing
prepare/send results and unavailable preparation are explicit retryable
failures. The first-run opt-out window remains separate and supplies no
scheduled send authority, so it can still consume its intentional no-send
occurrence. Immediately before MIME construction and each recipient provider
entry, the web callback resolves the complete canonical snapshot again and
returns addresses only when its proof matches.

## Content and Tone

### Data source

Whatever the member consented to share with the group, no more. The generic
`vault-cli group shared` command reads the landed
`murph.shared-vault-projections.v1` records. `vault-cli group weekly` turns the
same records into per-member current-week summaries with
`buildSharedGroupWeeklyMembers` (`packages/query/src/group-weekly.ts`), which
reuses the canonical overview weekly-stat calculation. Scheduled runs pass their
exact occurrence to that reader, which uses the group vault timezone, so retries
keep the same calendar week. Projection delivery carries up to seven
records per projection kind so one delivery can refill a full weekly window
after a quiet member runtime. Seven retained records cannot also prove a
complete prior calendar week, so the generic result deliberately omits prior-
week averages and deltas. One shared body; everyone on the thread sees the same
digest.

Default content is a selective weekly story, not one repeated metric block per
featured member. Lead with the strongest close race, leader, surprising
combination, or current-week group pattern; use the returned stats that develop
that story. Cross-person comparisons may include exercise, movement, steps,
sleep duration, sleep timing, consistency, and other consented group
metrics. Do not rank "healthiest person" or default to raw biomarker
leaderboards; use HRV, resting heart rate, weight, symptoms, and similar
context-dependent measures mainly for group-level patterns unless the group
explicitly chose that challenge metric.

Express durations in human units. Use "about 30 minutes of movement a day"
instead of raw minute totals. The `group weekly` `activity-minutes` stream is
broad movement per observed day. The separate `workout-minutes` stream is
exercise averaged over recorded workout days. Neither payload has a coverage
count or weekly total, so never multiply an average into a weekly sum. The
current `workout-count` average omits zero-workout days, so it
cannot support weekly workout totals or workout-count rankings. The payload
also cannot support prior-week change, monthly highs, or four-week highs. Call
genuinely broad activity "movement" and reserve "exercise" for
workout/exercise sources. A normal rich edition may use roughly 6–12 useful
stats, but every number should establish a leader, race, surprise, or current-
week group pattern instead of merely proving the field was
available. Omit missing-data callouts. Build the featured set only from
participants with a verified email and at least one current-week stat; do not
use any other participant's health data in the subject or body.

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

Individual and self-service. A member says "take me off the newsletter" **in the group chat**; Murph maps the authenticated sender (Linq `senderHandle`) to their member id and revokes **only that member's own** `group-email.v0` grant via `revokeHostedVaultSharesWithCleanupTx`. An **email-thread reply cannot revoke**: the email `From` header is unauthenticated and spoofable, so email-sourced opt-out fails closed and Murph instead directs the member to the group chat or settings. For the same reason, an email-thread reply may converse and read current group context but cannot create, edit, import, pause, or reactivate automations or mutate group join links/offers, display name, avatar, or contact-card state; those controls require the authenticated group chat. Revoking removes them from the thread and from being featured, while their challenge/health-sharing (a separate grant) stays intact. Opt-out is **forward-only** — editions already delivered are already in inboxes.

## Security & Abuse

- **Join is the consent gate.** Only members who (a) have a Murph account, (b) accepted this group's join link themselves or reacted to a disclosed server-owned offer, (c) granted email sharing, (d) granted any health projections the newsletter uses, and (e) have a verified email can be on the newsletter. Adding phone numbers to an iMessage group grants none of this — **you cannot enroll non-participants**, so there is no "blast a group of strangers" vector.
- **Residual risk.** In a group people *have* joined, any member (per any-member setup) can create a newsletter that would immediately broadcast every participant's **email address** (visible thread) and **health summary** to the whole group. Email-sharing default-on amplifies this; the first send is an **irreversible exposure**; an immediate fire leaves no chance to opt out.
- **Mitigation — announce + opt-out window before the first send.** Newsletter creation posts a clear group notice and the **first edition does not fire immediately or silently**; it respects a short opt-out window so every participant can decline before any exposure. Owner-only setup would not help (an attacker can be the owner), so the notice window is the control regardless of setup rights.
- **Address visibility is by design** (shared reply-all thread) and authorized by the grant; consent copy must say plainly that the email is shared *with the group*. If in-group address privacy is ever required, the listserv/group-alias model hides addresses behind one group address (bigger build — see Open Items).
- **Group-thread reply sender identity** uses the same web-owned `From`-address matching as the existing public-sender email lane; `From` spoofing is a shared, accepted residual of that model, with platform-level DKIM verification deferred because Cloudflare does not reliably expose `Authentication-Results` to Workers today.
- **Health-data posture.** The disclosed reaction offer or join page is the health-sharing consent checkpoint. The announce + opt-out window is an additional protection before the first irreversible email exposure, not a substitute for grant disclosure. Review consent copy against `apps/web/src/lib/legal/consent.ts` and the FTC HBNR compliance docs before launch.
- **Newsletter composition boundary.** Scheduled newsletter composition has no
  prior conversation thread or shell capability and receives health facts only
  through the trusted `prepare.result.members` result, filtered by current
  email eligibility and exact live data-grant ids resolved after local
  projection/timezone loading. Send requires a matching same-occurrence
  preparation and carries its address-free proof to the final web callback,
  which rechecks the complete authorization snapshot before provider entry, so
  revoked facts cannot remain in an already-composed email. Before a sent parent
  exists, a proof mismatch prevents provider entry and the occurrence remains
  retryable through the outbox lifecycle. After a parent is sent, a later proof
  mismatch is terminal for that occurrence, and safe recipient retries copy the
  sent parent payload rather than composing a second body under the same message
  identity. Transient runtime unavailability remains retryable. When preparation
  finds no email-eligible participant, trusted runtime code records the
  terminal `no_recipients` result and closes send authority while the model
  returns the documented group settings reminder.

## The Skill

The dedicated `group-newsletter` assistant skill owns the editorial story,
human-readable units, comparison rules, subject, tone, calibrated examples, and
final email. The `group-chat` skill owns the room-level setup questions,
group-chosen name and schedule, chat-delivery routing, email-share offer,
announce-before-first-send behavior, and opt-out handling. Saved automation
instructions explicitly tell every future scheduled run to read the newsletter
skill because notification turns may not retain the setup conversation or load
the group-chat skill. The skill carries no durable state itself; state lives in
the automation and grants.

## Net-New Surface (summary)

1. `group-email.v0` grant kind + join-policy display + disclosed newsletter reaction-share scope + "shared with the group" consent copy.
2. Group-send path in the hosted-email transport: assemble the participant address list web-side, build one shared MIME (`To`: all, stable `Message-ID`/`References`), HTML body, send one envelope copy per participant.
3. Generic `vault-cli group shared` and `vault-cli group weekly` readers over
   `murph.shared-vault-projections.v1`, backed by one Node store loader shared
   with destination-side ingestion and the newsletter send guard. The reusable
   current-week summary builder lives in `packages/query`; both the CLI and the
   trusted newsletter preparation path call it.
4. `group-newsletter` skill + the automation it authors (group-chosen name as title, schedule as cron, tone in instruction text), including setup questions, announce-before-first-send + opt-out window, shell-disabled scheduled composition with the skill preloaded, and Murph taking part in email-thread replies via the existing inbound ingress.
5. Latest-7-record vault-share projection delivery for weekly newsletter stats, still bounded by existing per-kind receiver retention.
6. `?addEmail=true` settings deep-link + private missing-email reminder through the member's own Murph.

Everything else is reuse: scheduling, health projections, rollup engine, roster, grant plumbing, tone guardrails, outbound email transport, inbound email ingress.

## Open Items / Future Work

- **Listserv / hidden-address model**: a per-group email alias that hides individual addresses behind one group address, as a privacy upgrade over the visible-address MVP.
- **Murph's email-thread depth**: starts as full participation (reacts/answers like the group chat); tune verbosity so it does not over-reply.
- **Catch-up send**: optionally email the latest edition immediately when a pending member first verifies an email, instead of waiting for the next cycle.
- **Group-scoped web config surface**: if a future web UI must show/manage newsletter settings, promote config from the automation instruction text to a `HostedGroup` JSON blob + a `murph.group` write action. Not needed for MVP.
- **Operational**: confirm the ~3k/month Cloudflare free tier is comfortable; jitter weekly sends; pick the from-name ("Murph" vs "Murph — [Group]"); decide which timezone "Sunday 9am" means for a distributed group.
- **Consent review**: copy + flow against `consent.ts` and FTC HBNR posture.

## Deployment Concerns

The hosted newsletter callback keeps old `read_stats`, snapshot-less, and
proof-less
`prepare` requests wire-compatible only so they can fail closed with
`newsletter_runner_upgrade_required`. A successful `prepare` requires
both `includeAuthorizationSnapshot: true` and
`includeAuthorizationProof: true`, and returns the address-free live grant
snapshot plus its SHA-256 proof. The model-facing schema exposes only `prepare`
and `send`; the proof and HTML stay in trusted outbox/effect state. The legacy request
parser exists only to prevent an ambiguous transport failure during rollout.

Deploy the fail-closed Vercel/web callback first and keep that version as the
web rollback floor. Then deploy Cloudflare/runner with
`container_rollout=immediate`, with no newsletter occurrence between those
deploys. An old runner in that interval receives
`newsletter_runner_upgrade_required`, not participant or health data, because
it omits the new proof marker. Its cron path predates the current retry contract,
so the operational schedule gap is required to avoid spending an occurrence
without a send. Do not roll web back below this authorization-proof floor while
the current runner is active. After both are live, run one
preparation call and confirm the trusted web wire contains only member ids,
email eligibility, and address-free share ids/scope keys, while the model-facing
runner result contains only the authorized current-week facts and no raw email
addresses or grant metadata. Confirm a scheduled send first persists the
existing-outbox parent and recipient children, re-resolves the current
authorization snapshot, fails closed when either recipients or health grants
change after preparation, and preserves its idempotency key without replaying a
sent or ambiguous child.

The base newsletter change spans **Cloudflare** (`apps/cloudflare`: HTML MIME, group-send path, address-resolution callback, inbound thread participation) and **Vercel/web** (`apps/web`: `group-email.v0` display + default request, address-resolution endpoint, `?addEmail=true`). Safe deploy order is **web first, then Cloudflare** — the web resolution endpoint and the new grant kind must exist before the Worker calls them. Both sides must recognize `group-email.v0` during the window.

The private missing-email nudge subfeature spans **Vercel/web** (`apps/web`: appends `group-newsletter.email-needed` mailbox wakes with a per-wake `directRoute`) and the hosted runner bundle (`packages/assistant-runtime`: imports that wake into a private direct conversation). Safe deploy order is **Cloudflare/runner first with `container_rollout=immediate`, then Vercel/web**. Gradual rollout with warm old runner containers is unsafe after the web producer is enabled: an old runner can import a direct-route-dependent wake as `group-newsletter.email-needed.no-direct-route`, advance the mailbox lane watermark, and spend the once-ever nudge key. The compatible runner behavior is that no-route newsletter nudges are retryable/deferred and do not advance mailbox import progress. The rollback floor after web deploy is the runner bundle that understands wake-level `directRoute` and defers no-route newsletter imports; do not roll Cloudflare below that floor unless the web producer is reverted or disabled first. Post-deploy check: enqueue or observe one missing-email nudge with `directRoute` and confirm the runtime records `group-newsletter.email-needed.staged` rather than `group-newsletter.email-needed.no-direct-route`.
