# Call Circle v1 Implementation Plan

Date: 2026-07-06
Spec: `agent-docs/product-specs/call-circle.md` (read it fully first; it is
the decision record and overrides any conflicting detail here).
Branch: `feat/call-circle-v1-f5` (this worktree).

Our utmost priority is clean, simple, long term maintainable and composable
architecture with minimal complexity.

## Goal

Implement Call Circle v1 exactly as spec'd: a web-owned coordinator (two
tables, one web cron) that matches enrolled group members for 1:1 phone
calls, converses with members through their own Murphs via existing
notification wakes, and connects confirmed pairs with a Retell connector
call (text-handoff fallback when the connector agent env is unset).

## Build Order And Files

### 1. Shared contract (`packages/hosted-execution/src/call-circle.ts`, new)

- Zod schemas + types for the member response: `{ kind: "preferences" |
  "confirm" | "counter" | "decline" | "pause" | "resume", groupId,
  matchId?, side?, windows?, counterWindow? }`. Windows are coarse:
  `{ dayOfWeek, startLocalTime, endLocalTime }[]` plus optional structured
  exclusions `{ excludeMemberIds: string[] }`. Counter is one absolute
  window `{ startAt, endAt }`.
- Path constants: `HOSTED_CALL_CIRCLE_RESPOND_PATH =
  "/api/internal/call-circle/respond"`.
- Follow `packages/hosted-execution/src/phone-calls.ts` as the shape
  template. Export via the package's public entrypoint like phone-calls.
- Extend the group tool contract in
  `packages/hosted-execution/src/runtime-control.ts`: add action
  `call_circle_enroll` (input: `memberId`) to the existing group action
  union, and extend the `read_current` result summary with per-member
  `callCircle: { enrolled, paused } | null`. Do NOT add any other group
  actions.

### 2. Prisma schema + migration (`apps/web/prisma/schema.prisma`)

- `HostedCallCircleParticipant`: id, groupId -> HostedGroup, memberId ->
  HostedMember, status enum (`enrolled` | `paused`), preferencesJson (Json:
  windows + excludeMemberIds), lastMatchedAt DateTime?, createdAt/updatedAt.
  `@@unique([groupId, memberId])`.
- `HostedCallCircleMatch`: id, groupId, memberAId, memberBId, windowStartAt,
  windowEndAt (absolute UTC), status enum (`proposed` | `asking` |
  `both_confirmed` | `bridging` | `completed` | `dropped` | `expired` |
  `canceled`), per-side fields: sideAResponse / sideBResponse enum
  (`pending` | `confirmed` | `declined` | `countered`), counterUsedA /
  counterUsedB Boolean, stage timestamps (amAskedAt, finalAskedAt,
  claimedAt, endedAt), outcome String?, phoneCallId String? ->
  HostedPhoneCall. Indexes on (groupId, createdAt) and (status,
  windowStartAt). `@@unique([groupId, memberAId, memberBId, windowStartAt])`.
- Every lifecycle transition in code below must be a single conditional
  `updateMany({ where: { id, status: <expected> }, data })` returning count
  1, never read-modify-write.
- Follow the repo's existing migration workflow (look at
  `apps/web/prisma/migrations/` and the `prisma:migrate:*` scripts; generate
  the migration the same way recent migrations were added).

### 3. Web stores/services (`apps/web/src/lib/call-circle/`, new module)

- `participant-store.ts`: idempotent enroll (create-or-return), pause/resume,
  preferences upsert, list eligible for a group.
- `match-store.ts`: create match (respecting the unique key), conditional
  transitions, the single claim function
  `claimMatchForCall(matchId)`: one conditional update `status:
  both_confirmed -> bridging` that also checks `windowStartAt <= now <
  windowEndAt`; callers must re-verify both members still active
  (`readActiveHostedMemberAccess`) and enrolled before claiming.
- `matcher.ts`: deterministic pure matcher. Inputs: enrolled+unpaused
  participants with preferences, recent matches for rotation, per-member
  eligibility flags. Rules (all DB/code enforced): max one proposal per
  member per 7 days (derive from lastMatchedAt / recent match rows — no new
  state), never repeat the immediately previous pair, rotate to least
  recently matched pairs first, propose a window from the intersection of
  both members' stated windows converted to absolute time using each
  member's timezone (see 6), skip members failing eligibility preflights
  (see 5). Pure function + thin loader so tests cover rules directly.
- `free-busy.ts`: `readMemberCalendarFreeBusy(memberId, {startAt, endAt})
  -> "free" | "busy" | "unknown"`. Resolve the member's connected calendar
  account deterministically via the existing connected-apps service
  (`apps/web/src/lib/connected-apps/service.ts`); execute a read-only
  free/busy or event-list tool through the existing session-execute path
  with a small fixed candidate slug list (try Google freebusy/events-list
  slugs, then Outlook). ANY error, missing account, or unparseable result
  returns "unknown" — this helper must never throw into the scheduler and
  never persist anything.
- `notifications.ts`: append member-facing wakes using the existing
  mailbox notification helper pattern from
  `apps/web/src/lib/hosted-onboarding/family-plan.ts` (the private member
  notification appender around line 2475) — reuse/extract, do not fork a
  second mechanism. Wake event ids: `call-circle:setup:<groupId>:<memberId>`,
  `call-circle:confirm-am:<matchId>:<side>`,
  `call-circle:confirm-final:<matchId>:<side>`,
  `call-circle:handoff:<matchId>:<side>`,
  `call-circle:outcome:<matchId>:<side>`. Instructions on the wake carry
  the ask framing (see Copy Rules) and explicitly direct the member's Murph
  to record the answer with the call-circle tool.
- `scheduler.ts`: the stage engine, called from the cron route. For due
  matches: send AM asks in the recipient's local morning (09:00-11:00
  local, computed from HostedMember timezone), send final asks ~20 minutes
  before windowStartAt, expire matches whose window passed without both
  confirms (record outcome `expired`), claim + start the connector call at
  windowStartAt when `both_confirmed`, and on bridge failure or missing
  connector env, mark outcome `text_handoff` and append handoff wakes to
  both sides. Quiet hours: never schedule a send outside 08:00-21:00
  recipient-local; clamp or skip. All sends must pass the
  line-health/eligibility preflight (see 5) at send time; blocked sends
  record a match outcome rather than silently vanishing.

### 4. Web routes

- `apps/web/app/api/internal/call-circle/respond/route.ts`: mirrors
  `apps/web/app/api/internal/phone-calls/route.ts` —
  `requireHostedCloudflareCallbackRequest`, parse the contract, then: the
  authenticated bound member may only touch their own participant row and
  matches where they are a side, and only while the relevant ask/state is
  pending. `confirm`/`counter`/`decline` apply conditional side updates;
  when both sides confirmed, transition match to `both_confirmed`. Counter:
  allowed once per side (checked in the conditional update); a counter
  resets the other side's response to pending, updates the window (validate
  it falls within the next 7 days), and triggers a re-ask wake for the
  other side via scheduler logic. Preferences/pause/resume update the
  participant row. Reject everything else 4xx.
- `apps/web/app/api/internal/call-circle/cron/route.ts`: follow the auth
  pattern of `apps/web/app/api/internal/hosted-onboarding/stripe/cron/route.ts`
  exactly; body runs matcher (per group due when it has no match created in
  the last 7 days) then scheduler. Add the cron entry to
  `apps/web/vercel.json` with a 10-minute cadence, matching existing
  entries' style.
- Extend the group tool handler
  `apps/web/src/lib/hosted-groups/group-tool.ts` with `call_circle_enroll`:
  validate the target memberId is an active member of this group
  (`readActiveHostedMemberAccess` + membership), idempotently create the
  participant row, and append the setup wake. Extend the `read_current`
  builder in `apps/web/src/lib/hosted-groups/group-store.ts` with the
  callCircle summary.

### 5. Eligibility preflights (web-side, hard gates)

- 28-day recipient-reply guard: reuse the existing helpers/data behind
  `apps/web/src/lib/hosted-onboarding/linq-egress-engagement.ts` to check a
  member has recent-enough inbound for a compliant send; do NOT bypass or
  reimplement policy — extract/reuse the existing recency read. Ineligible
  members are skipped by the matcher for that cycle.
- Line health: reuse existing line-health reads used by routing; if the
  member's route cannot deliver, skip.
- Notification route existence: reuse the pattern from
  `apps/web/src/lib/phone-calls/notification-route.ts`.

### 6. Timezone

- Member local time comes from the IANA timezone stored inside Call Circle
  participant preferences, next to that member's coarse availability
  windows. The member-thread response tool must submit the current runtime
  timezone with `kind: "preferences"`. Scheduler, confirmation, counter,
  connector, and notification formatting paths read this participant
  preference timezone and do not fall back to `HostedMember`
  `pendingActivationTimeZone` for Call Circle scheduling.

### 7. Cloudflare port + dynamic tool

- `apps/cloudflare/src/runtime-platform/call-circle-port.ts`: mirror
  `phone-calls-port.ts` (POST the respond path with boundUserId through
  `fetchHostedWebControlPlaneJson`).
- Wire it into the runtime platform/tool context exactly where the
  phone-calls port is wired (search its references and mirror every one).
- `packages/assistant-engine/src/assistant-codex/dynamic-tools/call-circle.ts`:
  a member-side tool `murph.call_circle_respond` following
  `dynamic-tools/phone-calls.ts` structure: available on manual/auto-reply
  triggers when the hosted tool context provides the call-circle transport.
  Description must instruct: use only to record the member's OWN stated
  preferences/confirmations for Call Circle, never invent answers, never
  include phone numbers. Also extend the existing `murph.group` dynamic
  tool description/action list for `call_circle_enroll` (group runtime
  attributes an in-chat opt-in to a roster memberId; description forbids
  enrolling anyone who did not opt in in this chat).
- Register in the dynamic-tools index/planning the same way phone-calls is
  registered.

### 8. Retell connector call

- Env: `RETELL_CONNECTOR_AGENT_ID` (+ optional
  `RETELL_CONNECTOR_AGENT_VERSION`) read alongside existing Retell env in
  `apps/web/src/lib/phone-calls/retell-runtime.ts` env reader; absent env
  means the bridge is disabled and scheduler uses text handoff.
- `apps/web/src/lib/call-circle/connector-call.ts`:
  `startConnectorCall(match)` — after `claimMatchForCall` succeeds, resolve
  member B's verified phone with a dedicated resolver (same verified-only
  logic as `apps/web/src/lib/phone-calls/transfer.ts` but for the OTHER
  member, callable only with a claimed match), then create the call through
  `createHostedPhoneCall` with: memberId = member A, requestKey =
  `call-circle:<matchId>`, a connector brief variant (no health content;
  opening line per spec; agent id/version overrides), transfer number =
  B's phone. Extend the phone-call brief/runtime minimally to allow an
  agent override + connector opening line; do not fork the Retell runtime.
- Webhook results: connector calls flow through the existing
  ended/analyzed webhook path; map failure to match outcome `text_handoff`
  (scheduler picks it up) and success to `completed`. Keep the existing
  member-facing result notification suppressed or minimal for connector
  calls (the outcome wakes already tell both sides what happened) — prefer
  the smallest change that avoids a confusing duplicate notification.

### 9. Copy rules (all wake instructions and tool descriptions)

- Follow `agent-docs/operations/imessage-deliverability.md`: reply-oriented,
  in-chat task framing, no acquisition/broadcast/exact-send phrasing.
- Confirm asks must be answerable in 1-3 characters (yes/no).
- No em dashes in any user-facing copy. No security overclaims. Explain the
  feature plainly; never imply a specific person requested the call.

### 10. Tests (colocate with each owner's existing test patterns)

- Match store: conditional transition semantics (double-claim races: only
  one winner), counter-once-per-side, both-confirmed convergence.
- Matcher: pure-function tests for caps (1/member/week, no immediate repeat
  pair, rotation fairness, exclusions honored, window intersection with
  timezones, eligibility skips).
- Respond route: auth (wrong member 403 / non-side member rejected), state
  validation (respond to non-pending ask rejected), preferences upsert,
  pause stops matching.
- Group tool: `call_circle_enroll` membership validation + idempotency +
  setup wake append (dedupe id).
- Scheduler: quiet-hour clamping, expiry outcomes recorded, handoff path
  when connector env unset, no send without eligibility.
- Free/busy: returns `unknown` on every failure mode; never throws.
- Contract: schema parse/reject tests in hosted-execution like
  phone-calls has.
- Dynamic tool registration test in assistant-engine mirroring the
  phone-calls tool test.
- Cloudflare port test mirroring phone-calls-port test.

## Edge Cases To Handle

- Enroll called twice / for an already-paused member (resume vs no-op:
  re-enroll of a paused member should NOT silently unpause; leave paused).
- Member leaves group or loses access mid-match: every transition
  predicate re-checks membership + `readActiveHostedMemberAccess`; failed
  predicate records outcome `canceled`.
- Counter window in the past or beyond 7 days: reject in route validation.
- Both sides counter simultaneously: conditional updates make one win; the
  loser's counter gets rejected by state; their Murph is informed via the
  re-ask wake carrying the new window.
- Cron overlap (two concurrent cron invocations): all mutations are
  conditional updates, so double-running is harmless; matcher creation is
  protected by the unique key.
- Odd participant counts: someone sits out; rotation must not starve them
  next cycle (least-recently-matched ordering covers it).
- Groups with fewer than 2 eligible participants: matcher no-ops.
- DST boundaries: use the IANA timezone conversion at schedule time, store
  absolute UTC on the match row, never re-derive the window later.

## Out Of Scope (do not build)

Mystery mode, per-group cadence tuning, a dedicated assistant skill, any
new VaultShare kind, a generic notification rail or purpose enum, a
bridge-session table, new consent tables, group-visible scoreboards,
model-driven matching.

## Verification

- `pnpm test:diff <touched paths>` when truthful; otherwise owner-scoped
  vitest for `apps/web`, `packages/hosted-execution`,
  `packages/assistant-engine`, `apps/cloudflare` touched suites.
- Typecheck the touched workspaces.
- Do not run hosted local E2E (Prisma guard blocks it under this harness);
  note it for CI.

## ReviewGPT Follow-Up 2026-07-07

Accepted findings from the PR ReviewGPT pass:

- Connector handoff and missed-bridge handoff must terminalize the match
  before per-recipient notification preflight so quiet hours cannot leave a
  bridge stuck open.
- The connector agent must transfer immediately after the opening line
  because web already recorded both final confirmations.
- Explicit match-id responses must not mutate expired windows.
- Weekly proposal group discovery must be bounded.
- The Call Circle spec must state web/runner/assistant deploy-skew and
  rollback behavior.

Focused follow-up verification:

- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/call-circle-connector-call.test.ts apps/web/test/call-circle-match-store.test.ts apps/web/test/call-circle-scheduler.test.ts apps/web/test/call-circle-response-service.test.ts`
- `pnpm --filter @murphai/hosted-web typecheck`

## ReviewGPT Follow-Up 2 2026-07-07

Accepted findings from the second PR ReviewGPT pass:

- Immediate partner repeats can happen just outside the 7-day cooldown; keep
  existing match history as the source of truth and pass each participant's
  last partner into the matcher.
- Fixed first-100 scans can starve later groups or setup asks; page group
  discovery and pending setup participants through the full current result
  set in each scheduler run.
- Completed-call notifications must not ask an ambiguous renewal yes/no
  because the response resolver has no stable group context there.
- Setup notification egress must re-check active member access, group
  membership, and enrolled/no-preferences participant state in the append
  transaction before sending.

Focused follow-up verification:

- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/call-circle-matcher.test.ts apps/web/test/call-circle-scheduler.test.ts apps/web/test/call-circle-notifications.test.ts apps/web/test/call-circle-match-store.test.ts apps/web/test/call-circle-response-service.test.ts apps/web/test/call-circle-connector-call.test.ts`

## ReviewGPT Follow-Up 3 2026-07-07

Accepted findings from the third PR ReviewGPT pass:

- Due matches and terminal result notifications also need stateless paging;
  proposal/setup scans alone are not enough to avoid first-100 starvation.
- Connector fallback handoffs must revalidate the active participant pair
  before config fallback and again inside the handoff terminalization
  transaction.
- Offer-reaction Call Circle setup egress must use the same active access,
  group membership, and enrolled/no-preferences participant guard as the
  scheduler setup path.

Focused follow-up verification:

- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/call-circle-matcher.test.ts apps/web/test/call-circle-scheduler.test.ts apps/web/test/call-circle-notifications.test.ts apps/web/test/call-circle-match-store.test.ts apps/web/test/call-circle-response-service.test.ts apps/web/test/call-circle-connector-call.test.ts apps/web/test/hosted-group-join-offer-reaction.test.ts`

## ReviewGPT Follow-Up 23 2026-07-08

Accepted findings from the Phlebas PR-head rerun:

- Failed provider sends, missing provider message ids, and binding failures
  now revoke only the matching unbound durable offer reservation. Stale
  unbound reservations also self-expire on reaction after a short binding
  grace window, so thread-level reaction retry cannot be permanently poisoned.
- Call Circle offer acceptance now uses the accepted offer's posted time to
  resume a previously paused participant only when the pause predates the
  fresh offer. Older reaction replays still leave the paused state intact.
- Definite Retell create-call rejections now fail the local unstarted call row
  immediately through the existing phone-call owner path. Ambiguous start
  failures remain `starting` and continue to avoid duplicate provider starts.

Focused follow-up verification:

- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/hosted-group-store.test.ts apps/web/test/hosted-group-tool.test.ts apps/web/test/hosted-group-join-offer-reaction.test.ts apps/web/test/call-circle-match-store.test.ts apps/web/test/phone-calls-service.test.ts apps/web/test/phone-calls-retell.test.ts apps/web/test/call-circle-connector-call.test.ts`
- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/hosted-group-store.test.ts apps/web/test/hosted-group-tool.test.ts apps/web/test/hosted-group-join-offer-reaction.test.ts apps/web/test/hosted-onboarding-linq-http.test.ts apps/web/test/call-circle-matcher.test.ts apps/web/test/call-circle-scheduler.test.ts apps/web/test/call-circle-notifications.test.ts apps/web/test/call-circle-match-store.test.ts apps/web/test/call-circle-response-service.test.ts apps/web/test/call-circle-connector-call.test.ts apps/web/test/phone-calls-call-circle-result.test.ts apps/web/test/phone-calls-service.test.ts apps/web/test/phone-calls-retell.test.ts apps/web/test/phone-calls-retell-real-consult-route.test.ts apps/web/test/call-circle-cron-route.test.ts apps/web/test/hosted-retention-cleanup.test.ts apps/web/test/hosted-retention-cron-route.test.ts apps/web/test/production-migration-guard.test.ts apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts apps/web/test/hosted-onboarding-webhook-idempotency.test.ts`
- `pnpm --filter @murphai/hosted-web typecheck`

## ReviewGPT Follow-Up 25 2026-07-08

Accepted findings from the Phlebas PR-head rerun:

- Reaction-side binding of an unbound offer from only thread identity was too
  broad for consent. Reactions now only accept rows already bound to the exact
  provider message lookup key; unbound thread reservations remain retryable so
  the send-side idempotent tool path can recover the provider message binding.
- Definite Retell connector-start rejection stores a failed phone-call row with
  no provider identity but a populated `providerStartAttemptedAt`. Connector
  handoff now treats `failed` plus no provider id/end/analysis as local
  pre-provider failure regardless of that attempt marker.

Focused follow-up verification:

- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/hosted-group-join-offer-reaction.test.ts apps/web/test/hosted-group-tool.test.ts apps/web/test/call-circle-connector-call.test.ts apps/web/test/call-circle-scheduler.test.ts apps/web/test/phone-calls-service.test.ts`
- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/hosted-group-store.test.ts apps/web/test/hosted-group-tool.test.ts apps/web/test/hosted-group-join-offer-reaction.test.ts apps/web/test/hosted-onboarding-linq-http.test.ts apps/web/test/call-circle-matcher.test.ts apps/web/test/call-circle-scheduler.test.ts apps/web/test/call-circle-notifications.test.ts apps/web/test/call-circle-match-store.test.ts apps/web/test/call-circle-response-service.test.ts apps/web/test/call-circle-connector-call.test.ts apps/web/test/phone-calls-call-circle-result.test.ts apps/web/test/phone-calls-service.test.ts apps/web/test/phone-calls-retell.test.ts apps/web/test/phone-calls-retell-real-consult-route.test.ts apps/web/test/call-circle-cron-route.test.ts apps/web/test/hosted-retention-cleanup.test.ts apps/web/test/hosted-retention-cron-route.test.ts apps/web/test/production-migration-guard.test.ts apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts apps/web/test/hosted-onboarding-webhook-idempotency.test.ts`
- `pnpm --filter @murphai/hosted-web typecheck`

## ReviewGPT Follow-Up 26 2026-07-08

Accepted findings from the Phlebas PR-head rerun:

- Provider-attempted Call Circle bridge starts with no stored provider call id
  are not Call Circle scheduler facts to terminalize. Follow-Up 26 removes
  the scheduler-owned start-timeout failure branch added in Follow-Up 24; the
  existing phone-call/Retell recovery owners remain responsible for later
  provider facts.
- Thread-scoped unbound offer state is not a consent authority. Reactions now
  accept only exact provider-message-bound offer rows. When provider send
  succeeds but DB binding fails, the tool best-effort deletes the specific
  provider-visible offer and revokes the unbound reservation only after that
  cleanup succeeds; if cleanup cannot be confirmed, the unbound reservation
  remains for an idempotent resend/bind retry.

Focused follow-up verification:

- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/call-circle-scheduler.test.ts apps/web/test/hosted-group-tool.test.ts apps/web/test/hosted-group-join-offer-reaction.test.ts apps/web/test/hosted-onboarding-linq-http.test.ts`

## ReviewGPT Follow-Up 27 2026-07-08

Accepted findings from the Phlebas PR-head rerun:

- Counter responses no longer append immediate confirmation re-asks from the
  response route. The response path only records the counter mutation; the
  scheduler-owned confirmation path remains the single owner for calendar
  availability, quiet-hour/line preflight, ask stamping, and notification
  append.
- Weekly Call Circle proposal caps are now enforced at the match-store claim
  boundary across all groups. The store locks both hosted-member rows in
  stable order, rejects any blocking recent match containing either member,
  and then updates per-group `lastMatchedAt` fairness metadata.
- Response target resolution no longer treats model-supplied `groupId` or
  `matchId` as authority without a durable notification anchor. Unanchored
  setup responses use only a singleton active participant group; unanchored
  match responses use only a singleton pending match, while model ids can only
  fail closed on exact-anchor conflicts.

Focused follow-up verification:

- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/call-circle-response-service.test.ts apps/web/test/call-circle-match-store.test.ts`

## ReviewGPT Follow-Up 28 2026-07-09

Accepted findings from the Phlebas PR-head rerun:

- Multi-group lifecycle/off-ramp replies could fail closed when the user
  replied to a Call Circle confirmation notification with a non-match action
  such as `pause`. Non-match response target resolution now reuses the
  existing confirmation notification anchor only when it is exact, current for
  the match, and paired with a fresh user reply; model-provided ids remain
  conflict checks only.
- Final confirmation asks skipped the calendar free/busy preflight used by
  morning asks. Final asks now preflight notification reachability, check both
  member calendars before marking/sending, and drop the match as
  `calendar_busy` without final notifications when either member is busy.

Focused follow-up verification:

- `pnpm --filter @murphai/hosted-web test:prepared -- apps/web/test/call-circle-response-service.test.ts apps/web/test/call-circle-scheduler.test.ts`
- `pnpm --filter @murphai/hosted-web typecheck`
- `git diff --check`
- `pnpm no-js`

## ReviewGPT Follow-Up 29 2026-07-09

Accepted finding from the Phlebas PR-head rerun:

- Calendar free/busy checks happen outside the DB transaction, so a stale busy
  result must not use the broad outcome writer after another owner has marked
  an ask, collected confirmations, claimed a bridge, or attached a phone call.
  Calendar-busy drops now use two stage-scoped match-store mutations fenced by
  the exact observed stage, group, window, side responses, `claimedAt: null`,
  and `phoneCallId: null`; stale zero-row updates do nothing.

Focused follow-up verification:

- `pnpm --filter @murphai/hosted-web test:prepared -- apps/web/test/call-circle-scheduler.test.ts apps/web/test/call-circle-match-store.test.ts`
- `pnpm --filter @murphai/hosted-web typecheck`

## ReviewGPT Follow-Up 30 2026-07-09

Accepted finding from the Phlebas PR-head rerun:

- Scheduler ask/drop transitions still used stale match snapshots after
  notification and calendar preflight. Morning and final ask markers now pass
  the exact staged group/window/side-response tuple plus ask/claim/call
  guards into the match-store conditional update; notification-blocked drops
  now use stage-scoped store mutations instead of the broad outcome writer.
  If the fenced update loses a race, the scheduler appends no confirmation
  notifications.

Focused follow-up verification:

- `pnpm --filter @murphai/hosted-web test:prepared -- apps/web/test/call-circle-scheduler.test.ts apps/web/test/call-circle-match-store.test.ts`
- `pnpm --filter @murphai/hosted-web typecheck`
- `git diff --check`
- `pnpm no-js`

## ReviewGPT Follow-Up 24 2026-07-08

Accepted findings from the Phlebas PR-head rerun:

- Ambiguous Retell start failures that already stamped
  `providerStartAttemptedAt` could leave a confirmed Call Circle bridge in
  `starting` until the generic phone-call sweep. The scheduler now has a
  Call Circle-owned timeout after the match window plus a short grace: it
  conditionally fails only the still-unidentified phone-call row, then uses
  the existing text-handoff notification path. It never retries Retell.
- A visible Linq offer whose post-send DB bind failed was being revoked. The
  post path now leaves that unbound reservation live, and a later reaction can
  bind exactly one active unbound reservation in that thread to the reacted
  provider message before running the normal acceptance path. Ambiguous
  unbound reservations remain retryable.

Focused follow-up verification:

- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/hosted-group-tool.test.ts apps/web/test/hosted-group-join-offer-reaction.test.ts apps/web/test/call-circle-scheduler.test.ts apps/web/test/call-circle-connector-call.test.ts apps/web/test/phone-calls-service.test.ts`
- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/hosted-group-store.test.ts apps/web/test/hosted-group-tool.test.ts apps/web/test/hosted-group-join-offer-reaction.test.ts apps/web/test/hosted-onboarding-linq-http.test.ts apps/web/test/call-circle-matcher.test.ts apps/web/test/call-circle-scheduler.test.ts apps/web/test/call-circle-notifications.test.ts apps/web/test/call-circle-match-store.test.ts apps/web/test/call-circle-response-service.test.ts apps/web/test/call-circle-connector-call.test.ts apps/web/test/phone-calls-call-circle-result.test.ts apps/web/test/phone-calls-service.test.ts apps/web/test/phone-calls-retell.test.ts apps/web/test/phone-calls-retell-real-consult-route.test.ts apps/web/test/call-circle-cron-route.test.ts apps/web/test/hosted-retention-cleanup.test.ts apps/web/test/hosted-retention-cron-route.test.ts apps/web/test/production-migration-guard.test.ts apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts apps/web/test/hosted-onboarding-webhook-idempotency.test.ts`
- `pnpm --filter @murphai/hosted-web typecheck`

## ReviewGPT Follow-Up 5 2026-07-07

Accepted findings from the fifth PR ReviewGPT pass:

- Duplicate stable request-key recovery for an attached, unstarted Call
  Circle bridge must actually start the existing HostedPhoneCall reservation
  after server-side match and participant revalidation, instead of replaying
  `starting` until stale failure.
- Multi-group setup replies must resolve the group from exact hosted mailbox
  anchors carried in server-injected tool context, not from latest-prior
  notification scans or model-authored group guesses.
- Preference writes must not implicitly resume paused participants; explicit
  resume remains the only paused-to-enrolled transition.

Focused follow-up verification:

- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/phone-calls-service.test.ts apps/web/test/call-circle-connector-call.test.ts apps/web/test/call-circle-match-store.test.ts apps/web/test/call-circle-response-service.test.ts`
- `pnpm --filter @murphai/assistant-engine test -- assistant-return-contact-kind.test.ts assistant-automation-runtime.test.ts`
- `pnpm --filter @murphai/assistant-engine typecheck`
- `pnpm --filter @murphai/hosted-web typecheck`
- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/call-circle-matcher.test.ts apps/web/test/call-circle-scheduler.test.ts apps/web/test/call-circle-notifications.test.ts apps/web/test/call-circle-match-store.test.ts apps/web/test/call-circle-response-service.test.ts apps/web/test/call-circle-connector-call.test.ts apps/web/test/hosted-group-join-offer-reaction.test.ts apps/web/test/phone-calls-service.test.ts`

## ReviewGPT Follow-Up 6 2026-07-07

Accepted findings from the sixth PR ReviewGPT pass:

- Duplicate attached-bridge recovery needs a durable one-caller egress claim
  before Retell start. Duplicate callers now return `starting` while the
  existing reservation is fresh; stale recovery atomically bumps the existing
  row version before provider egress, and losers return the current status.
- Exact setup mailbox context must override model-authored group guesses for
  non-match Call Circle responses. If a request `groupId` conflicts with the
  exact setup context, the server now fails closed instead of writing private
  availability to the wrong group.

Focused follow-up verification:

- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/phone-calls-service.test.ts apps/web/test/call-circle-connector-call.test.ts apps/web/test/call-circle-match-store.test.ts apps/web/test/call-circle-response-service.test.ts`
- `pnpm --filter @murphai/hosted-web typecheck`

## ReviewGPT Follow-Up 7 2026-07-07

Accepted finding from the seventh PR ReviewGPT pass:

- Hosted assistant notification outbox intents must carry the notification
  mailbox item ids as answered/context mailbox ids, so a later native reply
  can recover the exact setup notification anchor for Call Circle preferences.

Focused follow-up verification:

- `pnpm --filter @murphai/assistant-engine test -- assistant-notification-turn-runtime.test.ts assistant-automation-runtime.test.ts assistant-return-contact-kind.test.ts`
- `pnpm --filter @murphai/assistant-engine typecheck`

## ReviewGPT Follow-Up 8 2026-07-07

Accepted findings from the eighth PR ReviewGPT pass:

- Phone-call rows now stamp a provider-start attempt on `updatedAt` before
  provider egress. Duplicate recovery can start only stale rows with no prior
  attempt marker; stale rows with a prior attempt fail closed instead of
  risking a second external call.
- Setup mailbox context resolution is tri-state. Ambiguous setup context now
  fails closed before consulting model-supplied `groupId` or participant
  fallbacks.

Focused follow-up verification:

- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/phone-calls-service.test.ts apps/web/test/call-circle-response-service.test.ts apps/web/test/call-circle-connector-call.test.ts apps/web/test/call-circle-match-store.test.ts`
- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/call-circle-matcher.test.ts apps/web/test/call-circle-scheduler.test.ts apps/web/test/call-circle-notifications.test.ts apps/web/test/call-circle-match-store.test.ts apps/web/test/call-circle-response-service.test.ts apps/web/test/call-circle-connector-call.test.ts apps/web/test/hosted-group-join-offer-reaction.test.ts apps/web/test/phone-calls-service.test.ts`
- `pnpm --filter @murphai/hosted-web typecheck`
- `pnpm --filter @murphai/assistant-engine test -- assistant-notification-turn-runtime.test.ts assistant-automation-runtime.test.ts assistant-return-contact-kind.test.ts`
- `pnpm --filter @murphai/assistant-engine typecheck`

## ReviewGPT Follow-Up 9 2026-07-07

Accepted findings from the ninth PR ReviewGPT pass:

- The generic `HostedPhoneCall` provider-egress idempotency boundary must be
  a durable nullable fact, not an inference from `updatedAt`. The prior
  Follow-Up 8 marker is superseded by `providerStartAttemptedAt`, set once
  immediately before Retell egress after local preflight and transfer-number
  resolution. Duplicate recovery can only start stale reservations where this
  field is still null.
- Provider-start errors after `providerStartAttemptedAt` is set are
  ambiguous external attempts. Keep the row `starting` instead of locally
  failing it, so a later Retell webhook with `murph_phone_call_id` can repair
  the row.
- The long stranded-bridge scheduler lookback must include attached
  `bridging` matches as well as unattached ones; the existing recoverable
  phone-call predicate remains the guard for attached rows.

Focused follow-up verification:

- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/phone-calls-service.test.ts apps/web/test/call-circle-scheduler.test.ts`
- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/call-circle-matcher.test.ts apps/web/test/call-circle-scheduler.test.ts apps/web/test/call-circle-notifications.test.ts apps/web/test/call-circle-match-store.test.ts apps/web/test/call-circle-response-service.test.ts apps/web/test/call-circle-connector-call.test.ts apps/web/test/hosted-group-join-offer-reaction.test.ts apps/web/test/phone-calls-service.test.ts`
- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/phone-calls-service.test.ts apps/web/test/phone-calls-retell.test.ts apps/web/test/phone-calls-retell-real-consult-route.test.ts apps/web/test/phone-calls-call-circle-result.test.ts`
- `pnpm --filter @murphai/hosted-web typecheck`
- `pnpm --filter @murphai/assistant-engine typecheck`

## ReviewGPT Follow-Up 10 2026-07-08

Accepted findings from the tenth PR ReviewGPT pass:

- Confirmation, decline, and counter replies can omit model-authored
  `matchId` when the reply context already contains the exact Call Circle
  confirmation notification mailbox item. Resolve exactly one
  `assistant.notification.requested:call-circle:{stage}:{matchId}:{memberId}:{windowStartAt}`
  anchor from the reply context before falling back to single-pending-match
  disambiguation; fail closed if multiple distinct confirmation anchors are
  present.
- Retell local validation must remain pre-egress. Run runtime start
  validation before setting `providerStartAttemptedAt`, so deterministic
  local env/request failures fail the local phone-call row instead of leaving
  a permanent `starting` reservation.

Not accepted from this pass:

- The suggestion to replace model-authored Call Circle group offer copy with
  a deterministic server template conflicts with the current product direction
  for this PR. Keep the model-authored offer surface plus server-side
  validation/binding/reaction activation.

Focused follow-up verification:

- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/call-circle-response-service.test.ts apps/web/test/phone-calls-service.test.ts`
- `pnpm --filter @murphai/hosted-web typecheck`

## ReviewGPT Follow-Up 11 2026-07-08

Accepted findings from the eleventh PR ReviewGPT pass:

- Ambiguous Retell provider-start attempts must not remain `starting`
  forever when no webhook arrives. The hosted retention cron now runs a
  bounded sweep over old `HostedPhoneCall` rows with
  `providerStartAttemptedAt`, no provider id, no ended/analyzed timestamps,
  and `status = starting`; each row is failed and has its normal result
  notification appended in the same transaction, then the notification wake
  is signaled best-effort.
- A Call Circle bridge must not wait forever when Retell sends `call_ended`
  but never sends `call_analyzed`. The scheduler now hands off an attached
  `bridging` match after the match window ends and the ended phone call has
  waited through a short analysis grace period without `analyzedAt`.
- The registered Call Circle Vercel cron must stay dormant until rollout.
  The cron route now requires `HOSTED_CALL_CIRCLE_CRON_ENABLED=1`; otherwise
  it returns a typed skipped result before scheduler work.

Focused follow-up verification:

- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/call-circle-scheduler.test.ts apps/web/test/call-circle-cron-route.test.ts apps/web/test/phone-calls-retell.test.ts apps/web/test/hosted-retention-cleanup.test.ts apps/web/test/hosted-retention-cron-route.test.ts apps/web/test/production-migration-guard.test.ts`
- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/call-circle-matcher.test.ts apps/web/test/call-circle-scheduler.test.ts apps/web/test/call-circle-notifications.test.ts apps/web/test/call-circle-match-store.test.ts apps/web/test/call-circle-response-service.test.ts apps/web/test/call-circle-connector-call.test.ts apps/web/test/hosted-group-join-offer-reaction.test.ts apps/web/test/phone-calls-service.test.ts apps/web/test/phone-calls-retell.test.ts apps/web/test/phone-calls-retell-real-consult-route.test.ts apps/web/test/phone-calls-call-circle-result.test.ts apps/web/test/call-circle-cron-route.test.ts apps/web/test/hosted-retention-cleanup.test.ts apps/web/test/hosted-retention-cron-route.test.ts apps/web/test/production-migration-guard.test.ts`
- `pnpm --filter @murphai/hosted-web typecheck`
- `pnpm --filter @murphai/assistant-engine typecheck`
- `pnpm docs:drift`
- `git diff --check`

## ReviewGPT Follow-Up 12 2026-07-08

Accepted finding from the twelfth PR ReviewGPT pass:

- Call Circle scheduler recovery must not terminalize an attached Retell call
  after the phone-call owner has durably recorded
  `providerStartAttemptedAt`. Scheduler and connector-call retry predicates
  now only treat attached calls as unstarted when `providerStartAttemptedAt`
  is null; provider-attempted rows stay owned by the Retell webhook or hosted
  phone-call stale-start sweep.

Focused follow-up verification:

- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/call-circle-scheduler.test.ts apps/web/test/call-circle-connector-call.test.ts apps/web/test/phone-calls-retell.test.ts apps/web/test/phone-calls-call-circle-result.test.ts`
- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/call-circle-matcher.test.ts apps/web/test/call-circle-scheduler.test.ts apps/web/test/call-circle-notifications.test.ts apps/web/test/call-circle-match-store.test.ts apps/web/test/call-circle-response-service.test.ts apps/web/test/call-circle-connector-call.test.ts apps/web/test/hosted-group-join-offer-reaction.test.ts apps/web/test/phone-calls-service.test.ts apps/web/test/phone-calls-retell.test.ts apps/web/test/phone-calls-retell-real-consult-route.test.ts apps/web/test/phone-calls-call-circle-result.test.ts apps/web/test/call-circle-cron-route.test.ts apps/web/test/hosted-retention-cleanup.test.ts apps/web/test/hosted-retention-cron-route.test.ts apps/web/test/production-migration-guard.test.ts`
- `pnpm --filter @murphai/hosted-web typecheck`

## ReviewGPT Follow-Up 13 2026-07-08

Accepted findings from the thirteenth PR ReviewGPT pass:

- Hosted phone-call failure writes must not take ownership back after another
  actor records `providerStartAttemptedAt`. The start marker and all
  pre-provider failure writes now share the same durable
  unstarted/unattempted predicate, and zero-row failure writes refetch
  provider-attempted rows as advanced/owned instead of failing them locally.
- Call Circle group offers must include the generated join path in the
  actually sent chat message. The model still authors the offer text, but the
  message must include `{{join_url}}` exactly once; web fills the generated
  join URL before sending and records the same server-owned offer binding.

Focused follow-up verification:

- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/phone-calls-service.test.ts apps/web/test/phone-calls-retell.test.ts apps/web/test/hosted-group-tool.test.ts`
- `pnpm exec vitest run --config vitest.config.ts --no-coverage test/parsers.test.ts test/call-circle.test.ts` from `packages/hosted-execution`
- `pnpm exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-group-tool.test.ts test/assistant-call-circle.test.ts` from `packages/assistant-engine`
- `pnpm --filter @murphai/hosted-web typecheck`
- `pnpm --filter @murphai/hosted-execution typecheck`
- `pnpm --filter @murphai/assistant-engine typecheck`

## ReviewGPT Follow-Up 14 2026-07-08

Accepted finding from the fourteenth PR ReviewGPT pass:

- Call Circle local-time scheduling must not use signup activation timezone
  after a member is active. Participant preferences now require and store an
  IANA `timeZone`, the assistant response tool submits it for preference
  updates, and scheduler/response/connector paths read member-local time
  from participant preferences. Missing preference timezones fail closed
  instead of falling back to UTC or `HostedMember.pendingActivationTimeZone`.

Focused follow-up verification:

- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/call-circle-response-service.test.ts apps/web/test/call-circle-scheduler.test.ts apps/web/test/call-circle-connector-call.test.ts apps/web/test/call-circle-match-store.test.ts apps/web/test/call-circle-matcher.test.ts apps/web/test/call-circle-route.test.ts apps/web/test/call-circle-notifications.test.ts`
- `pnpm exec vitest run --config vitest.config.ts --no-coverage test/call-circle.test.ts` from `packages/hosted-execution`
- `pnpm exec vitest run --config vitest.config.ts --no-coverage test/assistant-call-circle.test.ts` from `packages/assistant-engine`
- `pnpm --filter @murphai/hosted-web typecheck`
- `pnpm --filter @murphai/hosted-execution typecheck`
- `pnpm --filter @murphai/assistant-engine typecheck`

## ReviewGPT Follow-Up 15 2026-07-08

Accepted findings from the Phlebas PR ReviewGPT pass:

- Confirmation reply anchors must identify the current ask, not only the
  match. Response handling now carries confirmation anchor stage and
  `windowStartAt` through resolution and rejects an old AM anchor after a
  final ask, or an old-window anchor after a counter reask.
- Retell result webhooks must use the same participant-preference timezone
  guard as the scheduler before appending Call Circle terminal
  notifications. The phone-call result path now reads Call Circle
  participant timezones and preflights each outcome/handoff notification
  with that explicit timezone.

Focused follow-up verification:

- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/call-circle-response-service.test.ts apps/web/test/phone-calls-call-circle-result.test.ts`
- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/call-circle-matcher.test.ts apps/web/test/call-circle-scheduler.test.ts apps/web/test/call-circle-notifications.test.ts apps/web/test/call-circle-match-store.test.ts apps/web/test/call-circle-response-service.test.ts apps/web/test/call-circle-connector-call.test.ts apps/web/test/hosted-group-tool.test.ts apps/web/test/hosted-group-join-offer-reaction.test.ts apps/web/test/phone-calls-service.test.ts apps/web/test/phone-calls-retell.test.ts apps/web/test/phone-calls-retell-real-consult-route.test.ts apps/web/test/phone-calls-call-circle-result.test.ts apps/web/test/call-circle-cron-route.test.ts apps/web/test/hosted-retention-cleanup.test.ts apps/web/test/hosted-retention-cron-route.test.ts apps/web/test/production-migration-guard.test.ts`
- `pnpm --filter @murphai/hosted-web typecheck`

## ReviewGPT Follow-Up 16 2026-07-08

Accepted finding from the Phlebas confirmation rerun:

- Like-to-consent group offers must make the visible provider message a
  durable consent anchor even if binding needs a retry. Group offers now
  reserve a `HostedGroupJoinOffer` attempt before sending, use the attempt
  id as the provider idempotency identity, and bind the same row to the
  provider message lookup key after send. Retries reuse only an unbound
  matching attempt; once an offer is bound, a later identical offer creates
  a fresh attempt instead of silently suppressing the new post.
- Mixed web deploys must keep existing group-offer vault-share consent
  compatible with old reaction handlers. Offer scope writes now keep the
  existing `projection_kinds_json` column as an array of consent tokens, so
  old readers still grant vault-share projections while new readers can also
  recognize feature activation tokens.

Focused follow-up verification:

- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/hosted-group-tool.test.ts apps/web/test/hosted-group-store.test.ts`
- `pnpm --filter @murphai/hosted-web typecheck`
- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/hosted-group-store.test.ts apps/web/test/hosted-group-tool.test.ts apps/web/test/hosted-group-join-offer-reaction.test.ts`
- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/hosted-group-tool.test.ts apps/web/test/hosted-group-store.test.ts apps/web/test/hosted-group-join-offer-reaction.test.ts apps/web/test/call-circle-matcher.test.ts apps/web/test/call-circle-scheduler.test.ts apps/web/test/call-circle-notifications.test.ts apps/web/test/call-circle-match-store.test.ts apps/web/test/call-circle-response-service.test.ts apps/web/test/call-circle-connector-call.test.ts apps/web/test/phone-calls-call-circle-result.test.ts`

## ReviewGPT Follow-Up 17 2026-07-08

Accepted finding from the Phlebas PR-head rerun:

- Confirmation notification mailbox items can resolve the current Call
  Circle match anchor, but they must not count as a fresh user reply. The
  response freshness query now reads only `conversation.message` mailbox
  items, with a regression covering an old reply plus newer notification
  anchor in the same context.

Focused follow-up verification:

- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/call-circle-response-service.test.ts`

## ReviewGPT Follow-Up 18 2026-07-08

Accepted finding from the Phlebas PR-head rerun:

- A send-succeeded/bind-failed group offer could leave a provider-visible
  like-to-consent message without a durable `HostedGroupJoinOffer` provider
  lookup key. A user reaction in that window would be acknowledged as
  `no_offer_match` and not replayed. Bind failure cleanup now revokes the
  unbound private attempt and deletes the just-sent Linq message; retries
  create a fresh attempt and provider idempotency key instead of reusing the
  possibly-reacted anchor.

Focused follow-up verification:

- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/hosted-group-tool.test.ts apps/web/test/hosted-group-store.test.ts apps/web/test/hosted-onboarding-linq-http.test.ts`

## ReviewGPT Follow-Up 19 2026-07-08

Accepted findings from the Phlebas PR-head rerun:

- Provider-attempted/no-provider-id Call Circle bridges must not be retried
  during the call window, but they also must not wait for generic phone-call
  retention before users get the text-handoff fallback. The scheduler now
  terminalizes the narrow ambiguous-start shape after the match window plus
  the existing bridge grace, reusing the existing `text_handoff` outcome and
  notification path.
- The synthetic unbound group-offer attempt lifecycle added too much state
  around the like-to-consent primitive. Follow-Up 19 supersedes the
  Follow-Up 18 cleanup shape by deleting unbound attempt rows, bind/revoke
  transitions, and `providerMessageBound`. Group offers now use a stable
  content fingerprint as the provider idempotency key and persist only
  provider-bound `HostedGroupJoinOffer` rows; recording the same provider
  message id is idempotent for retry recovery.

Focused follow-up verification:

- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/hosted-group-tool.test.ts apps/web/test/hosted-group-store.test.ts apps/web/test/hosted-onboarding-linq-http.test.ts apps/web/test/call-circle-scheduler.test.ts`

## ReviewGPT Follow-Up 20 2026-07-08

Accepted findings from the Phlebas PR-head rerun:

- Stable provider idempotency for group offers must not delete the provider
  message after a post-send DB record failure. The record-failure path now
  leaves the visible provider anchor in place so a retry with the same
  fingerprint can bind the provider-bound `HostedGroupJoinOffer` row.
- Connector handoff terminalization must not use a stale no-call match view
  to drop a bridge after another worker attaches a phone call. The connector
  handoff transaction now re-reads the current match state and terminalizes
  only when the current `phoneCallId` is still `null`; no-call handoff
  outcomes also pass `phoneCallId: null` into the existing conditional
  outcome write.

Focused follow-up verification:

- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/hosted-group-tool.test.ts apps/web/test/hosted-group-store.test.ts apps/web/test/hosted-group-join-offer-reaction.test.ts apps/web/test/hosted-onboarding-linq-http.test.ts apps/web/test/call-circle-connector-call.test.ts apps/web/test/call-circle-scheduler.test.ts`

## ReviewGPT Follow-Up 21 2026-07-08

Accepted findings from the Phlebas PR-head rerun:

- A local connector failure after `beforeStart` attached a phone call, but
  before provider start was attempted, could strand a `bridging` match with
  an attached failed call and no fallback. Connector handoff now re-reads
  the attached phone call and permits terminalization only for the narrow
  pre-provider failed shape, passing the exact attached `phoneCallId` into
  the existing conditional outcome write.
- A reaction to a visible group offer could arrive after provider send but
  before the provider-bound `HostedGroupJoinOffer` row existed. Valid
  positive no-offer reactions now persist a narrow pending reaction keyed by
  the hashed provider event id, member id, and existing hashed message/thread
  lookup candidates; provider-bound offer recording drains those pending
  rows through the same acceptance path.

Focused follow-up verification:

- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/call-circle-connector-call.test.ts apps/web/test/call-circle-scheduler.test.ts apps/web/test/hosted-group-tool.test.ts apps/web/test/hosted-group-store.test.ts apps/web/test/hosted-group-join-offer-reaction.test.ts apps/web/test/hosted-onboarding-linq-http.test.ts`

## ReviewGPT Follow-Up 22 2026-07-08

Accepted findings from the Phlebas PR-head rerun:

- Once a Call Circle bridge phone call has `providerStartAttemptedAt`, the
  phone-call subsystem owns recovery and terminalization. The scheduler no
  longer marks provider-attempted `starting` calls as text handoffs after a
  grace window; Retell webhook/result processing or the phone-call stale-start
  sweep remains the terminal owner.
- Follow-Up 21's pending-reaction table added a second owner beside the group
  offer. Group offers now reserve a durable `HostedGroupJoinOffer` by stable
  offer fingerprint before provider send, bind the provider message lookup key
  after send, and make positive no-offer reactions retryable only when the
  Linq thread has an active unbound reservation. The pending-reaction table and
  migration were removed.
- Call Circle enrollment now enforces the existing group-chat participant cap
  at the enrollment owner under the group row lock, preventing unbounded weekly
  proposal scans and fanout.

Focused follow-up verification:

- `pnpm --filter @murphai/hosted-web prisma:generate`
- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/call-circle-scheduler.test.ts apps/web/test/call-circle-match-store.test.ts apps/web/test/hosted-group-store.test.ts apps/web/test/hosted-group-tool.test.ts apps/web/test/hosted-group-join-offer-reaction.test.ts apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts`

## Local Deep-Review Follow-Up 5 2026-07-07

Accepted finding from the local Feynman pass while the fourth ReviewGPT
rerun was pending:

- Outcome writes that explicitly expect no attached phone call must keep
  `phoneCallId: null` in the conditional update; otherwise a missed-window
  handoff can race with bridge attachment and terminalize a match that has
  since gained a call row.

Focused follow-up verification:

- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/call-circle-match-store.test.ts apps/web/test/call-circle-scheduler.test.ts apps/web/test/call-circle-connector-call.test.ts`
- `pnpm --filter @murphai/hosted-web typecheck`

## ReviewGPT Follow-Up 4 2026-07-07

Accepted findings from the fourth PR ReviewGPT pass:

- A `bridging` match with an attached `starting` phone call and no provider
  call id must remain recoverable from durable rows after a crash between
  match attachment and Retell start finalization.
- Stale enrolled participants that lost active access or group membership
  must be filtered before greedy matching so they cannot consume active
  members and starve valid pairs.

Focused follow-up verification:

- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/call-circle-matcher.test.ts apps/web/test/call-circle-scheduler.test.ts apps/web/test/call-circle-notifications.test.ts apps/web/test/call-circle-match-store.test.ts apps/web/test/call-circle-response-service.test.ts apps/web/test/call-circle-connector-call.test.ts apps/web/test/hosted-group-join-offer-reaction.test.ts`
