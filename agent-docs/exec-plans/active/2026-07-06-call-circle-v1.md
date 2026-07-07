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

- Member local time comes from the timezone stored on `HostedMember`
  (signup `pendingActivationTimeZone` lineage). Add one small helper in the
  call-circle module that returns a member's IANA timezone with a UTC
  fallback; use it for window conversion, morning scheduling, and quiet
  hours. Do not add new timezone state.

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
