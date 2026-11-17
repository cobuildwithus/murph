# Push a reminder when a member's phone stops sending Apple Health data

Status: completed
Created: 2026-11-14
Updated: 2026-11-14

## Goal

The phone uploads Apple Health data only while the Murph app is alive. Once it
is quit, reinstalled or left signed out, nothing arrives, the source still reads
"connected", and almost nobody is told: the only nudge is one private text per
silence episode, evaluated only inside runtime apply, for members with a recent
direct Linq thread.

When a member's Apple Health source has delivered nothing for 24 hours, send a
push to their phone: title "Open Murph", body "Reopen Murph so your data can
stay up to date." (the copy of the app's own local notice). Bounded, at most
once a day, inside the member's daytime, and off when the member turned the
app's "Reopen reminders" switch off.

## Success criteria

- A member with a connected `apple_health_kit` source that delivered before, a
  registered push route with alerts allowed, and 24 hours of silence gets one
  push inside their local 9am to 9pm window, on wall time, with no runner wake
  and no Temporal action.
- Two overlapping sweeps cannot send twice, and every send leaves one row with
  member, episode, step, outcome and time.
- A member who turned "Reopen reminders" off on a build that reports it gets
  nothing.
- Opening the app clears the push on every build, old and new.
- The existing text nudge evaluates on wall time, no longer says "a few days"
  about a gap of unknown length, and cannot re-queue after the mailbox prune.

## Scope

- In scope: Web only on the server (`apps/web`), one additive Prisma migration,
  one Vercel cron entry, a small `murph-ios` change that reports the switch.
- Out of scope: never-delivered sources (a connect that never streamed is a
  setup failure, not a closed app, and "reopen" is the wrong advice); other
  providers; moving the text nudge onto the new clock (see Decisions); any
  Cloudflare runtime, runner, or Temporal worker change.

## Design

### Clock

A new Vercel cron, `/api/internal/device-sync/apple-health-reopen-push/cron`,
every 15 minutes. It is one indexed SQL read driven from `companion_push_route`
(one row per member: the phone that last registered), then one short
transaction and one APNs request per due member. Options compared:

| Mechanism | Wall time | Runner wake | Temporal actions | Verdict |
| --- | --- | --- | --- | --- |
| Runtime apply (today's text nudge) | No, wake `occurredAt` | Needs one | Rides a wake | Cannot see a member whose phone is silent, which is the case at hand |
| Temporal device-sync recovery Schedule (900s) | Yes | No | None added, but couples a member push to worker health and a private repo release | Rejected |
| Existing minute cron (Stripe, game lifecycle) | Yes | No | None | Rejected: billing-critical sweep with its own claim budget |
| New Vercel cron, 15 min | Yes | No | None | Chosen |

A 12 hour send window needs no finer grain than 15 minutes.

### Who is due

One query, paged by member id, joins `companion_push_route`, `hosted_member`,
`device_connection` (status `active`) and `device_connection_source`
(`apple_health_kit`, status `connected`, `last_data_at` not null), grouped by
member. `last_data_at` is stamped at webhook ingress, so it is an arrival clock.

- **Episode** = the member's newest `last_data_at` across those sources. A
  second phone that is still delivering therefore silences the reminder, and
  any new delivery starts a new episode.
- Nominated in SQL when the episode is at least 24 hours old,
  `alerts_allowed`, the route topic is a Murph iOS bundle id,
  `reopen_reminders` is not false, the member is not suspended, health-data
  consent is not revoked, the member did not tell Murph by text to stop Apple
  Health check-ins (`device_source_no_data_outreach_preference`), the app has
  made no contact for 24 hours (`hosted_member.companion_last_contact_at`, the
  app's 15 second heartbeat whenever iOS gives it execution, foreground or
  background: a live app does not need "reopen"), no push row exists for the
  member in the last 24 hours, and the current step of this episode has not
  been claimed. An exhausted episode therefore never reaches a transaction.
- Before any transaction, per page: active hosted access through the set-based
  `readActiveHostedMemberAccessIds` (without access the runner never applies
  data, so the reminder could never be satisfied), a "wait N days" text
  preference (pushes start at N days), and quiet hours.
- Claim, per member: lock the member row (the lock heartbeats, companion
  registration and the text preference already take), run the same nomination
  query for that one member, recheck access with the authoritative
  single-member read, insert the receipt.
- After commit and immediately before APNs: run the nomination query once more
  for the member, ignoring its own claim. If the route address, the episode or
  any gate changed, nothing is sent and the receipt reads `superseded`.

No session check. A member whose session expired is exactly who needs to
reopen and sign in, and the copy is generic. Sign-out asks the server to delete
the route, but that is a separate best-effort request from the app: a phone
that signed out while offline keeps its route and can get this reminder, on the
same bounded schedule, until Apple reports the token gone.

### Schedule

Silence-age thresholds in days: 1, 2, 3, 10, 17, 24. The step is the count of
thresholds already passed. A step is sent once; a missed step is not replayed
(a sweep outage sends the newest step only). After day 24 there is no later
threshold, so the episode goes quiet until data arrives. At most six pushes per
episode.

Adjustment to the proposed schedule: there is no separate "older than 30 days"
cutoff. An episode that has never had its last step sent gets exactly one push
whenever it first becomes reachable, then stops. Reason: most of today's silent
sources are already past day 30, and a cutoff would make the feature skip the
members it exists for. It costs no code: it is what the step table does.

### Quiet hours

9am to 9pm in `game_profile.time_zone` (the app registers a push route only for
game members, who all have a profile). With no profile or an invalid zone, send
only between 17:00 and 19:00 UTC, which is inside 9am to 9pm from US Pacific
through Central Europe all year. The APNs expiry is the end of that day's
window, so a phone that is offline does not get it at 3am.

### Send

Reuse `sendApplePush` and `companion_push_route` as game pushes do. Extend
`ApplePushRequest` with optional `threadId` and `interruptionLevel`.

- `apns-collapse-id` and `thread-id`: `murph.sync-interruption-reminder`, the
  identifier and thread of the app's local notice. Apple documents that a
  remote notification's `UNNotificationRequest.identifier` is its
  `apns-collapse-id`, so the app's existing
  `removeDeliveredNotifications(withIdentifiers:)` on open clears it on every
  shipped build, a later push replaces an earlier one, and it replaces the
  local notice instead of stacking a second copy.
- `interruption-level: time-sensitive` only when the route reported
  `reopen_reminders: true`. Apple's documentation says to enable the capability
  and does not say what an app without the entitlement does with the key. The
  field ships after build 106, which added the entitlement, so a route that
  reports it is known to hold it. Everyone else gets a normal alert.
- Data `{ notification: "reopen_reminder" }`. Shipped builds ignore unknown
  kinds: no foreground banner, tap just opens the app.
- Missing APNs credentials: the sweep returns without claiming anything.

Order per member: claim (insert the row, outcome `claimed`) inside the locked
transaction, commit, revalidate, send, record the outcome (`sent`, `failed`,
`unregistered`, `superseded`). A claim is never released, so a failed or
superseded send costs that one step. `unregistered` forgets that exact token,
as game pushes do.

### Data model

```prisma
model CompanionPushRoute {
  // null: this build has not reported the switch. Treated as on.
  reopenReminders Boolean? @map("reopen_reminders")
}

// One row per reopen push claimed for a member. Holds no content.
model AppleHealthReopenPush {
  userId           String   @map("user_id")
  episodeStartedAt DateTime @map("episode_started_at")
  step             Int
  outcome          String
  createdAt        DateTime @default(now()) @map("created_at")
  member           HostedMember @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([userId, episodeStartedAt, step])
  @@map("apple_health_reopen_push")
}
```

The primary key is the idempotency key. Rows are never pruned (at most six per
episode); they go with the member in account deletion and are added to the
privacy inventory.

### The switch

The server does not know the app's "Reopen reminders" switch today; it lives in
the phone's `UserDefaults`. The app adds `reopenReminders` to the route
registration it already sends on every foreground (`POST
/api/game/v1/push-route`) and re-registers when the switch changes. The server
accepts the optional field on both registration routes and stores
`true | false | null`. An omitted field means unknown: the game route stores
null (the build now holding the route has not reported), and the companion
route keeps the stored value only when the address is unchanged.

Builds before the app change send no field. For them the server sends a normal
alert on the schedule above, including to a member who turned the switch off on
that build; the app still clears it on open. That ends when they update.

### Text nudge fixes

1. Wall time: stall candidates and materialization use `new Date()` instead of
   the wake's `occurredAt`.
2. Copy: the Apple Health variants drop "a few days" for wording that does not
   state a length.
3. Prune: mailbox retention keeps the structural row (no payload) of a
   `device-delivery-stalled:v1:` notification instead of deleting it at 30
   days, so the episode's existing dedupe key keeps answering. The materializer
   stops on a consumed or content-retired row. No second record of the text
   episode is added, and rows written before this change are covered.

## Risks and mitigations

1. Risk: two sweeps overlap, or one retries.
   Mitigation: the claim transaction locks the member row, re-reads the
   episode, the 24 hour guard and the step, and inserts under a primary key.
2. Risk: APNs is down or slow.
   Mitigation: 2.5 second timeout per send, a 20 second sweep budget, outcome
   `failed` on the row; the next step still goes out.
3. Risk: a member opens the app every day but Health has nothing new, and is
   nagged anyway.
   Mitigation: the heartbeat gate above.
4. Risk: deploy skew. A new app sending `reopenReminders` to an older Web is
   rejected by the strict schema, which would also stop game route
   registration.
   Mitigation: Web ships first, the app after. Rolling Web back past this
   change once the app is out is unsafe and is called out in the PR.
5. Risk: migration.
   Mitigation: one new table and one nullable column with no default on a small
   table; no rewrite, no backfill, no hot-table lock. Expand-only.
6. Risk: Time Sensitive overuse.
   Mitigation: six per episode at most, daytime only, one switch to turn off.

## Deploy order

Web (migration runs predeploy, then the cron starts with the deployment). No
Cloudflare runtime change. No Temporal worker change. App last. No new
environment variable, credential or production setting: APNs keys and
`CRON_SECRET` are already in use.

## What gets deleted or simplified

Nothing is deleted. No new push path, sender, token store, Temporal schedule or
runner work is added.

## Tasks

1. ReviewGPT architecture review of this plan; record each finding here.
2. Migration and schema; privacy inventory.
3. `sendApplePush` thread and interruption level; route registration field.
4. Sweep, cron route, `vercel.json`.
5. Text nudge fixes.
6. Tests, owner docs, PR, CI, PR ReviewGPT rounds.
7. `murph-ios`: report the switch.

## Decisions

- The text nudge stays on runtime apply. Moving it onto the cron would need a
  cheap way to skip the many candidates that fail its Linq gates on every
  sweep. Not small; left as follow-up.

- Reconciled with the catalog-wide no-data check that merged to main while this
  PR was open. That change left the quiet predicate
  (`isSourceRecoveryNoticeEligible`) and Apple Health's three-day text threshold
  as they were. The push now calls that predicate for its per-member check, with
  its own one-day wait, so there is one definition of a quiet source. The SQL
  nomination stays as the set-based prefilter of the same facts. The three text
  fixes sit on top of the merged materializer unchanged, and the retention
  exemption covers every daily source's check-in, since they share the key
  prefix.

### ReviewGPT plan review (2026-11-14, architecture preset, GPT-6 Pro)

Response: `audit-packages/plan-quiet-phone-push.md` (not committed). The CLI
lost its wait before the thread URL settled; the answer was recovered from the
same thread with `thread export`, with no resend.

1. Keep text dedupe in the mailbox instead of a second text record. Accepted.
   The shared table is now push only; retention keeps the stall notice's
   structural row. This also closes the gap the first draft had for notices
   queued before the deploy.
2. Claim under the member lock, and check health-data consent. Accepted. A
   route-first lock inverts the order registration uses (member, then route)
   and could deadlock on the receipt's foreign key. Consent withdrawal commits
   before device disconnect, so a connected source alone does not prove
   consent. The plan also wrongly called the route "one row per installed
   app"; it is one row per member.
3. Report the switch through the companion registration route, because the
   game route answers 404 while games are off. Rejected, with evidence the
   reviewer did not have (no Swift in its snapshot): the switch lives on the
   game's Notifications page, and while games are off the app shows only
   "Games are off right now." with Sign out and Delete account
   (`GameClosedScreen`), so it cannot be changed then. The app registers a
   route only through the game path, and the companion route needs paid
   access that game players may not have. One writer is kept. Accepted from
   this finding: the meaning of an omitted field is now defined for both
   routes.
4. Revalidate between claim and APNs. Accepted, with the `superseded` outcome.
   The claim that sign-out deletes the route was wrong as a server invariant
   and is restated above.
5. Exclude claimed steps before the per-member transaction. Accepted: the
   nomination query computes the step from the one threshold list and drops
   claimed steps, stopped members and revoked consent.

Evidence gap the review named (native behavior), closed from `murph-ios`
`origin/main`: the local notice's identifier and thread are both
`murph.sync-interruption-reminder` (`SyncInterruptionReminder`); opening the
app removes delivered notifications with that identifier (`AppDelegate`
`cameOnScreen`, `AppSession.didBecomeActive`); Apple's
`UNNotificationRequest.identifier` page states a remote notification takes its
`apns-collapse-id`; `MurphCompanion.entitlements` carries the Time Sensitive
entitlement; `CompanionWakeRelay` shows no banner and routes nowhere for a
notification kind it does not know. Not proven on a device: replacement of a
delivered local notice by the remote one. `simctl push` cannot set a collapse
id, so that needs a real APNs send to a phone.

## Verification

- Commands to run: focused Vitest files for the sweep, sender, routes and stall
  notice; `pnpm test:diff` over touched paths; `pnpm typecheck`; exit codes
  captured.
- Expected outcomes: all pass; CI green on the PR head.
Completed: 2026-11-14
