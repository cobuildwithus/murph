# Call Circle v1 Implementation Plan

Date: 2026-07-06
Last updated: 2026-07-09
Status: completed
completion audits are done; commit/push, final PR review, and CI remain.
Spec: `agent-docs/product-specs/call-circle.md`
Branch: `feat/call-circle-v1-f5`

Our priority is the smallest composable architecture that preserves consent,
delivery, and phone-call authority. Reuse existing offer, mailbox, routing,
phone-call, and retention primitives. Add no feature-specific owner when an
existing owner can hold the fact.

## Goal

Ship Call Circle v1 as a web-owned coordinator for weekly one-to-one calls
inside an existing group. Members consent by reacting to a disclosed group
offer, give coarse availability to their own Murph, confirm a proposed time in
their private thread, and receive a Retell connector call only after both final
confirmations.

Success means the production path is reachable, duplicate-safe, bounded, and
fail-closed without a second consent system, notification queue, calendar
adapter, bridge session, or model-selected target.

## Build Order And Files

### 1. Reuse the generic group offer

Owners:

- `packages/hosted-execution/src/runtime-control.ts`
- `packages/assistant-engine/src/assistant-codex/dynamic-tools.ts`
- `apps/web/src/lib/hosted-groups/group-tool.ts`
- `apps/web/src/lib/hosted-groups/group-store.ts`
- `apps/web/src/lib/hosted-groups/join-offer-reaction.ts`

Use `post_join_offer` with optional activation
`call-circle.enroll.v0`. Web appends the consent disclosure, reserves the
generic offer before send, binds it to the exact provider message, and handles
the positive reaction through the generic join path. The reaction is the
explicit activation consent. There is no dedicated enrollment action,
Call Circle offer table, or second offer-identity lifecycle.

Only the server-owned `{{join_url}}` may render as a link. The shared URL-like
text guard rejects model-authored domains, IPs, and URI schemes.

`HOSTED_CALL_CIRCLE_OFFERS_ENABLED` gates only new offer posting. A reaction
still honors the activation already stored with a visible disclosed offer.

### 2. Keep coordination truth in two tables

Owners:

- `apps/web/prisma/schema.prisma`
- `apps/web/prisma/migrations/**call_circle**`
- `apps/web/src/lib/call-circle/participant-store.ts`
- `apps/web/src/lib/call-circle/match-store.ts`
- `apps/web/src/lib/call-circle/types.ts`

`HostedCallCircleParticipant` owns enrollment, pause state, coarse preferences,
and `nextMatchingAt`. `pausedAt` is the sole pause-intent clock;
`nextMatchingAt` is only a due cursor. Preference or scheduling updates must not
change whether a later offer is fresh enough to resume a paused participant.

`HostedCallCircleMatch` owns pair history, the absolute window, response and
counter state, stage timestamps, terminal outcome, and a unique
`phoneCallId` relation. Match rows are the source of truth for cooldowns,
rotation, and the last partner.

Every lifecycle write is a conditional update over the exact expected state.
Use stable member-row locks only at the cross-group weekly proposal claim, where
they enforce one proposal per member per rolling seven days.

### 3. Match and schedule with bounded server code

Owners:

- `apps/web/src/lib/call-circle/matcher.ts`
- `apps/web/src/lib/call-circle/scheduler.ts`
- `apps/web/src/lib/call-circle/time.ts`
- `apps/web/app/api/internal/call-circle/cron/route.ts`
- `apps/web/vercel.json`

The pure matcher intersects stated windows in valid participant timezones,
sorts by match history, and uses two passes: avoid each member's latest partner
first, then allow the repeat only when needed to avoid starvation. It does not
read calendars.

The scheduler uses ordered bounded phases for setup, proposal creation,
morning asks, final asks, bridge start, expiry, and handoff. Terminal transition
owners append result notifications directly. Newly eligible or updated
participants become due immediately; every considered participant advances to
the next Monday cadence boundary, so an already-deduped setup row cannot starve
later work.

The cron route stays dormant unless
`HOSTED_CALL_CIRCLE_CRON_ENABLED=1`.

### 4. Derive response targets from mailbox authority

Owners:

- `packages/hosted-execution/src/call-circle.ts`
- `packages/assistant-engine/src/assistant-codex/dynamic-tools/call-circle.ts`
- `packages/assistant-engine/src/assistant/automation/reply.ts`
- `apps/cloudflare/src/runtime-platform/call-circle-port.ts`
- `apps/web/app/api/internal/call-circle/respond/route.ts`
- `apps/web/src/lib/call-circle/response-service.ts`

The response contract is a strict discriminated union for preferences,
confirm, counter, decline, pause, and resume. It has no `groupId`, `matchId`,
`side`, route, or phone field.

The runtime supplies bounded answered mailbox ids. The reply pipeline carries
current and prior answered ids, capped at twenty. Web derives match authority
from an exact current notification anchor and a fresh inbound conversation
message. Lifecycle actions use an exact setup or confirmation anchor when
present, or the member's sole active participant group. Match actions have no
singleton fallback. Ambiguity and stale anchors fail closed.

### 5. Reuse assistant notifications and routing

Owners:

- `apps/web/src/lib/hosted-execution/assistant-notifications.ts`
- `apps/web/src/lib/call-circle/notifications.ts`
- `apps/web/src/lib/hosted-retention/cleanup.ts`

Append ordinary `assistant.notification.requested` mailbox items with stable
event ids. Resolve the concrete route before append. Linq requires an
established thread, the exact routed source line, a usable configured line,
and recent inbound engagement. Scheduled asks and outcomes also require a
valid participant timezone and local daytime. Setup is immediate but keeps all
other access and delivery checks.

Best-effort signaling delegates to the generic assistant-notification helper.
The generic retention cleanup retries one oldest unconsumed notification per
member in a bounded batch. Do not add Call Circle wake state or a recovery
worker.

### 6. Reuse the hosted phone-call owner

Owners:

- `apps/web/src/lib/call-circle/connector-call.ts`
- `apps/web/src/lib/phone-calls/service.ts`
- `apps/web/src/lib/phone-calls/retell-runtime.ts`
- `apps/web/src/lib/phone-calls/result.ts`
- `apps/web/src/lib/phone-calls/retell-payloads.ts`
- `apps/web/app/api/retell/webhook/route.ts`

Claim the match atomically after both final confirmations and active-pair
checks. Resolve the other member's verified phone server-side. Create one
ordinary `HostedPhoneCall`, attach it through the unique `phoneCallId`
relation, and use the existing provider-start marker for Retell egress
idempotency.

Do not parse the phone-call request key to recover a match. The relation is the
only bridge authority.

Subscribe to exactly `call_ended`, `call_analyzed`, `transfer_bridged`, and
`transfer_cancelled`. Persist the small `transferOutcome` fact so bridge
evidence survives webhook reorder, with bridged dominating cancelled. Write the
bounded result through compare-and-set. Keep generic results immutable; permit
only a Call Circle not-bridged result to upgrade to completed when later
authoritative bridge evidence arrives. Provider-attempted calls are owned by
the phone result path and its generic stale-start/stale-analysis sweeps; the
Call Circle scheduler only re-invokes the connector for unclaimed, claimed,
attached-but-unattempted, or attached pre-provider-failed shapes.

### 7. Lock the contract with focused proof

Owners:

- `apps/web/test/call-circle-*.test.ts`
- `apps/web/test/phone-calls-*.test.ts`
- `apps/web/test/hosted-group-*.test.ts`
- `apps/web/test/hosted-retention-*.test.ts`
- `packages/hosted-execution/test/call-circle.test.ts`
- `packages/assistant-engine/test/assistant-call-circle.test.ts`
- `apps/cloudflare/test/call-circle-port.test.ts`
- `agent-docs/product-specs/call-circle.md`

Cover consent binding, exact mailbox authority, strict request shapes,
participant and access loss, cross-group proposal caps, cursor advancement,
partner rotation, timezone and DST behavior, duplicate cron execution, route
and line preflight, connector idempotency, webhook reorder, immutable generic
results, monotonic Call Circle correction, and generic notification recovery.

## Copy Rules

- Keep asks reply-oriented, transparent, and easy to decline.
- Confirm asks must be answerable with a short yes or no.
- Never imply that a specific person requested the call.
- Never expose phone numbers, private availability, line state, or another
  member's private reply.
- Follow `agent-docs/operations/imessage-deliverability.md` for every outbound
  phone-number message.

## Edge Cases To Handle

- Provider send succeeds before offer binding: the exact unbound reservation
  makes reactions retryable; thread identity alone cannot activate consent.
- Offer, reaction, cron, response, and webhook retries: stable identities and
  conditional writes make losing callers no-op.
- Crash after a bridge claim, pre-provider phone attachment, or pre-provider
  failure: the bounded scheduler page re-invokes the same connector, which
  resumes inside the window or terminalizes after it.
- Pause, access loss, or group departure during a match: cancel before the next
  ask or provider-start marker; never reclaim a provider-attempted call.
- Old notification anchor after a counter or final ask: reject it.
- Notification anchor without a fresh user message: reject it.
- Invalid or missing timezone, DST boundary, local nighttime, missing route, stale
  engagement, or unusable Linq line: fail closed before append or call.
- Small or odd groups: prefer a new partner, permit a repeat when it is the only
  viable pair, and prioritize the least recently matched member next cycle.
- A setup item already exists: advance its due cursor so it cannot occupy the
  bounded first page forever.
- Retell events arrive twice or out of order: preserve bridge evidence, claim
  one result, allow only the not-bridged-to-completed correction, and replay
  only idempotent notification appends.
- Retell never sends a provider-start or analysis result: the generic bounded
  phone sweeps terminalize the ordinary phone-call row and reuse its result
  path.
- Web and runner deploy out of sync: gates stay off until schema, web, runner,
  assistant tool, and Retell configuration are all ready.

## Out Of Scope (do not build)

Calendar/free-busy reads, matching across groups, conference calls, mystery
mode, per-group cadence, group scoreboards, a dedicated assistant skill, a
Call Circle notification table or queue, a bridge-session table, another
consent system, private availability in the group runtime, and any model-owned
target or lifecycle decision.

## Verification

Before completion:

1. Format, generate, and validate Prisma; run the production migration guards.
2. Run focused Call Circle, generic group offer, phone-call/Retell, retention,
   hosted-execution, assistant-engine, and Cloudflare port tests.
3. Before enabling offers, prove the production Linq subscription includes
   signed `message.sent` and that the hosted webhook receives it. Treat
   outbound `message.received` as a legacy fallback only.
4. Run the touched workspace typechecks and root `pnpm typecheck`.
5. Run the repo-routed acceptance checks that truthfully cover the final diff.
6. Run completion-workflow security/privacy, coverage, simplify, and deep-review
   passes; resolve accepted findings without adding owner state.
7. Check `git diff --check`, stale architecture strings, and the final diff for
   secrets or personal identifiers.
8. Commit with `scripts/finish-task`, push the PR head, run ReviewGPT to zero
   accepted findings, and wait for green CI.

Completed local evidence:

- Prisma validation, root typecheck, web typecheck, docs gardening,
  `git diff --check`, and the final privacy/secret scan pass.
- The full web suite passes: 381 files passed, 1 skipped; 4,218 tests passed,
  9 skipped. Focused Call Circle, group-offer, phone-call/Retell, and cleanup
  suites pass, including the provider overlap, bounded-concurrency, retained
  cleanup-authority, pause-clock, and bridged-transfer regressions.
- Hosted execution, assistant engine, assistant runtime, Cloudflare, and
  messaging owner suites passed before the final web-local fixes; those fixes
  do not touch those owners.
- A serialized `pnpm verify:acceptance` run passed policy, typecheck, docs,
  artifacts, CLI coverage, and core coverage, then exposed fixed-deadline test
  flakes while the host was severely contended. The two assistant-engine
  retention cases and the setup wizard case passed in isolation. Four runtime
  wake/checkpoint cases still missed their 900-1,000 ms test-side deadlines;
  call-path tracing proved three inject a phase double that bypasses every
  changed Call Circle path, while the fourth never reaches changed reply
  delivery logic. Their owner suite had already passed with the feature diff.
- Final migration/coverage, security/privacy, simplicity, and deep-review
  audits report no actionable findings. The narrow residual uncertainty after
  provider-confirmed stop and process death is intentionally left to existing
  webhook/retry convergence instead of adding durable phase state.

## Review Outcome

Repeated review rounds exposed boundary ambiguity rather than a need for more
state. The final design collapses those fixes into existing owners:

- generic join offers own disclosed reaction consent;
- match rows own coordination history and phone binding;
- mailbox event ids own response context and notification dedupe;
- the shared route resolver and Linq line store own delivery authority;
- `HostedPhoneCall` owns provider attempts, transfer facts, final results, and
  stale webhook recovery;
- the generic retention sweep owns notification re-signaling.

Do not restore the deleted calendar helper, participant fairness timestamp,
dedicated enrollment action, second offer-identity mechanism, model target
ids, or feature-specific recovery machinery.
Updated: 2026-07-10
Completed: 2026-07-10
