# Group Health Newsletter

Last verified: 2026-07-07
Status: Specified (not yet implemented)

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
| Projection window | Each vault-share delivery can carry **the last 7 days per projection kind**, matching receiver retention. |

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
participants = group roster ∩ members who granted group-email.v0
featured      = participants who also granted disclosed health projections (else nothing to feature)
```

The single shared email is sent to all **participants** (`To`: all participant addresses). Its body features the **featured** members plus a few group superlatives. Roster + granted kinds come from `readHostedGroupMemberRoster` (`group-store.ts`); member id → display name from the auto-granted `profile-name.v0` share.

## Content and Tone

### Data source

Whatever the member consented to share with the group, no more. Per-member weekly stats are built from the health projections that land in the group vault as `murph.shared-vault-projections.v1` (`packages/assistant-runtime/src/hosted-runtime/vault-share-import.ts`), aggregated with the existing week-over-week engine `buildOverviewWeeklyStatsFromDailySampleSummaries` (`packages/query/src/overview-weekly-stats.ts`). Projection delivery carries up to seven records per projection kind so a single delivery can refill a full weekly window after a quiet member runtime. One shared body; everyone on the thread sees the same digest.

Default content: per featured member, steps total + Δ, avg sleep + Δ, workout count, one standout (PR or "most improved"), one gentle focus area; plus group superlatives (top mover, best sleeper, biggest improvement).

### Tone

- **Supportive by default** (never shaming, no purity/moralizing language, consistent with the global Murph persona). Because it is one shared email, any individual "focus area" is public within the group, so keep it constructive, sparse, and never demeaning; prefer aggregate framing ("the group's sleep slipped this week") over singling out the worst performer.
- **Coach-style roast only on explicit group opt-in** — the group asks Murph to "be hard on us like a coach." Even then it punches **upward** (the organizer, the loudest, the confident), stays about the effort/challenge and never the body, per the existing `group-chat/SKILL.md` guardrails.
- Optional free-text custom note tunes the vibe.

## Delivery

### Transport — reuse `HOSTED_EMAIL`

Outbound goes through the existing Cloudflare `send_email` binding `HOSTED_EMAIL` (`apps/cloudflare/wrangler.jsonc`) via `sendHostedEmailMessage` (`apps/cloudflare/src/hosted-email/transport.ts`), executed by the runner-outbound handler (`apps/cloudflare/src/runner-outbound/results.ts`). Cloudflare Email Service delivers to arbitrary recipients once a sending domain is onboarded. Domain onboarding is an **ops preflight item** (verify in the Cloudflare dashboard before launch; it is not provable from source). The `EmailMessage` payload is raw MIME, so HTML parts are supported. Free tier is 3,000 sends/month, then $0.35/1,000.

### Shared thread

The newsletter is one message the whole group is on:

- The MIME `To` header lists **all participant addresses**; the message carries a stable `Message-ID` (and `References` for replies) so it threads.
- The binding sends one envelope copy per participant (per-recipient RCPT) with identical MIME. Each recipient sees the same thread; **reply-all** reaches the other members via `To` and the group's Murph via `Reply-To`.
- HTML body (add an HTML alternative part to the outbound builder, which is text-only today).
- **`From`** = the configured hosted sender address (main's existing convention); **`Reply-To`** = the group runtime's signed reply alias, so replies land back in the group's Murph. **Murph participates in the thread** — inbound replies route through the existing hosted-email ingress (`apps/cloudflare/src/hosted-email/worker-ingress.ts`) into the group runtime, so Murph reacts/answers like it does in the group chat.
- A **new thread per weekly edition** (each week stands alone; avoids one ever-growing chain).

### Address resolution

The participant address list is assembled **web-side at send time** from members who granted `group-email.v0` (`readHostedMemberEmailAuthorization`, `apps/web/src/lib/hosted-onboarding/hosted-member-store.ts`). Addresses live only in the outbound headers, never in the group vault.

### No-email-yet member

Grant and address are decoupled: a member grants email permission at join even with **no verified email**. At each run, a participant with no resolvable address is **skipped for now** and Murph posts one in-chat nudge with `…/settings?addEmail=true`. When they add + verify an email (existing Privy → `/api/settings/email/sync` flow), the **next edition includes them automatically**. The `?addEmail=true` deep-link is a small web addition (copy the `home`/`connect` searchParams pattern; the settings dialog already auto-routes headless-vs-Privy-modal).

## Opt-out

Individual and self-service. A member says "take me off the newsletter" **in the group chat**; Murph maps the authenticated sender (Linq `senderHandle`) to their member id and revokes **only that member's own** `group-email.v0` grant via `revokeHostedVaultSharesWithCleanupTx`. An **email-thread reply cannot revoke**: the email `From` header is unauthenticated and spoofable, so email-sourced opt-out fails closed and Murph instead directs the member to the group chat or settings. Revoking removes them from the thread and from being featured, while their challenge/health-sharing (a separate grant) stays intact. Opt-out is **forward-only** — editions already delivered are already in inboxes.

## Security & Abuse

- **Join is the consent gate.** Only members who (a) have a Murph account, (b) accepted this group's join link themselves or reacted to a disclosed server-owned offer, (c) granted email sharing, (d) granted any health projections the newsletter uses, and (e) have a verified email can be on the newsletter. Adding phone numbers to an iMessage group grants none of this — **you cannot enroll non-participants**, so there is no "blast a group of strangers" vector.
- **Residual risk.** In a group people *have* joined, any member (per any-member setup) can create a newsletter that would immediately broadcast every participant's **email address** (visible thread) and **health summary** to the whole group. Email-sharing default-on amplifies this; the first send is an **irreversible exposure**; an immediate fire leaves no chance to opt out.
- **Mitigation — announce + opt-out window before the first send.** Newsletter creation posts a clear group notice and the **first edition does not fire immediately or silently**; it respects a short opt-out window so every participant can decline before any exposure. Owner-only setup would not help (an attacker can be the owner), so the notice window is the control regardless of setup rights.
- **Address visibility is by design** (shared reply-all thread) and authorized by the grant; consent copy must say plainly that the email is shared *with the group*. If in-group address privacy is ever required, the listserv/group-alias model hides addresses behind one group address (bigger build — see Open Items).
- **Group-thread reply sender identity** uses the same web-owned `From`-address matching as the existing public-sender email lane; `From` spoofing is a shared, accepted residual of that model, with platform-level DKIM verification deferred because Cloudflare does not reliably expose `Authentication-Results` to Workers today.
- **Health-data posture.** The disclosed reaction offer or join page is the health-sharing consent checkpoint. The announce + opt-out window is an additional protection before the first irreversible email exposure, not a substitute for grant disclosure. Review consent copy against `apps/web/src/lib/legal/consent.ts` and the FTC HBNR compliance docs before launch.

## The Skill

Add a `group-newsletter` entry to `ASSISTANT_SKILLS` (`packages/assistant-engine/src/assistant-skill-assets.ts`) and a `packages/assistant-engine/skills/group-newsletter/SKILL.md`, or extend `group-chat/SKILL.md` "Scheduled updates and automations." The skill teaches Murph to: ask the short setup question set before creating anything, apply the group-chosen name and schedule, route chat delivery to a normal scheduled group-chat update automation, ensure email sharing is requested for email delivery, author/edit/stop the email automation, **announce before the first send and honor the opt-out window**, compose the shared digest in-tone from the shared projections, send the group thread, take part in thread replies, and handle opt-out. It carries no durable state itself; state lives in the automation and the grants.

## Net-New Surface (summary)

1. `group-email.v0` grant kind + join-policy display + disclosed newsletter reaction-share scope + "shared with the group" consent copy.
2. Group-send path in the hosted-email transport: assemble the participant address list web-side, build one shared MIME (`To`: all, stable `Message-ID`/`References`), HTML body, send one envelope copy per participant.
3. Typed **reader** for `murph.shared-vault-projections.v1` (write side exists; no read side yet) feeding the rollup engine.
4. `group-newsletter` skill + the automation it authors (group-chosen name as title, schedule as cron, tone in instruction text), including setup questions, announce-before-first-send + opt-out window, and Murph taking part in email-thread replies via the existing inbound ingress.
5. Seven-day vault-share projection delivery windows for weekly newsletter stats, still bounded by existing per-kind receiver retention.
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

The change spans **Cloudflare** (`apps/cloudflare`: HTML MIME, group-send path, address-resolution callback, inbound thread participation) and **Vercel/web** (`apps/web`: `group-email.v0` display + default request, address-resolution endpoint, `?addEmail=true`). Safe deploy order is **web first, then Cloudflare** — the web resolution endpoint and the new grant kind must exist before the Worker calls them. Both sides must recognize `group-email.v0` during the window.
