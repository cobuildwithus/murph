# Hosted notification wake deletion

## Goal

Delete the generic `assistant.notification.requested` hosted wake and its direct
system-mailbox dispatch path.

Success criteria:

- Signup welcome delivery is handled by the existing `member.activated` wake.
- Device-sync reconnect notices are removed.
- Scheduled reminders still run only through canonical automations and assistant
  cron.
- Hosted usage/log attribution no longer makes direct system messages look like
  scheduled cron work.
- The hosted wake surface has fewer top-level event kinds and no generic
  "send arbitrary assistant notification" escape hatch.

## Current State

`assistant.notification.requested` is a generic system wake with only two
production producers:

- Signup welcome, created by `apps/web/src/lib/hosted-onboarding/member-activation.ts`.
- Device-sync reconnect notice, created by `apps/web/src/lib/device-sync/reconnect-notice.ts`.

Both production producers use `require_send_exact_text`, so the assistant
provider is not needed for the user-visible message. The runtime path still
routes through `sendAssistantNotification`, labels the turn as
`automation-cron`, and carries generic notification concepts that look like a
second reminder path.

Scheduled reminders are separate. They are canonical automations projected into
assistant cron, then executed by `packages/assistant-engine` through
`sendAssistantNotificationLocal`. That path is the one that should own reminder
service-tier policy.

## Target Architecture

Keep three primitives:

1. `member.activated`: member activation plus its exact signup welcome side
   effect.
2. `conversation.message`: user-originated inbound chat/email/message work.
3. Canonical automation plus assistant cron: delayed assistant work, including
   reminders and onboarding follow-up.

Delete the generic hosted system-notification wake. Do not replace it with a
new generic queue, scheduler, or notification event.

The only shared helper that should remain is a narrow exact-text delivery helper
inside the runtime layer. It should take already-resolved route, idempotency,
first-contact policy, and text. It should reuse the existing delivery/session
machinery without introducing a new top-level hosted wake kind.

## Non-Goals

- Do not delete assistant cron or canonical automations.
- Do not add Cloudflare-side scheduler semantics.
- Do not add a new Temporal signal kind for signup welcome.
- Do not keep device reconnect notices as another event under a new name.
- Do not make signup welcome provider-backed. It is exact text.

## Plan

### 1. Add member-activated welcome payload support

Extend `HostedExecutionMemberActivatedWake` with an optional signup welcome
payload that contains:

- the resolved delivery route
- exact welcome text
- delivery dedupe and idempotency keys
- first-contact marking policy

Keep the payload specific to activation. Do not reuse the generic
`HostedExecutionAssistantNotificationRequestedPayload` name or top-level event.

Runtime behavior:

- `executeHostedSystemWake` should handle `member.activated` by delivering the
  embedded exact welcome when present.
- If no welcome payload is present, `member.activated` remains a no-op.
- On successful welcome delivery, seed the existing onboarding follow-up
  canonical automation from the activation handler instead of from
  `assistant.notification.requested`.

Deploy compatibility:

- First deploy a runtime that can handle both old
  `assistant.notification.requested` welcome rows and new embedded
  `member.activated` welcome payloads.
- Then change web activation to emit one `member.activated` mailbox item with
  embedded welcome data instead of two mailbox items.
- After old mailbox rows have drained in production, delete the generic wake
  support.

### 2. Move web signup welcome production into member activation

In `apps/web/src/lib/hosted-onboarding/member-activation.ts`:

- Remove `buildHostedMemberSignupWelcomeNotificationWake`.
- Stop appending a second mailbox row for signup welcome.
- Build the welcome payload while building `member.activated`.
- Preserve the current route resolution and first-contact idempotency behavior.
- Preserve activation idempotency: a duplicate activation must not resend a
  welcome after first-contact delivery was accepted.

Update tests that currently expect two mailbox items so they expect one
activation item with embedded welcome data.

### 3. Delete device reconnect notice production

Remove the proactive device-sync reconnect notice feature:

- Delete `apps/web/src/lib/device-sync/reconnect-notice.ts`.
- Remove reconnect notice imports, calls, and post-commit signal handling from
  `apps/web/src/lib/device-sync/hosted-runtime-authority.ts`.
- Delete reconnect-notice tests and mocks.
- Remove reconnect-notice runtime log event codes from
  `packages/hosted-execution` and matching tests.

Keep the user-pulled reconnect surfaces, settings reconnect buttons, and
connect-link tooling. This plan deletes only the automatic proactive message.

### 4. Delete the generic hosted notification wake

After the compatibility window:

- Remove `HostedExecutionAssistantNotificationRequestedEvent`,
  `HostedExecutionAssistantNotificationRequestedWake`, and the builder/parser
  branches for `assistant.notification.requested`.
- Remove the `dispatch-assistant-notification` mailbox route action.
- Remove `executeHostedAssistantNotificationWake` and generic notification
  lifecycle logging from `packages/assistant-runtime`.
- Delete tests and E2E helper code that construct
  `assistant.notification.requested` directly, replacing signup-welcome cases
  with `member.activated`.

Keep `sendAssistantNotificationLocal` in `packages/assistant-engine`; assistant
cron still needs it for scheduled reminder notification turns.

### 5. Collapse reminder and service-tier confusion

Keep reminder execution on the existing assistant cron path:

- canonical automation record
- cron claim
- notification turn
- Codex/provider turn when needed
- delivery

Add or keep tests proving:

- clean hosted scheduled reminder attempts request flex when model/catalog
  support allows it
- retries clear the service tier
- Telegram scheduled reminders have the same flex assertion already present in
  the Linq scheduled-reminder E2E

Reduce the flex deadline if current code still allows an overly long first
attempt. Reminder latency should be bounded by product expectations, not by a
ten-minute provider wait.

### 6. Collapse hosted cron wake projection

After the wake deletion, simplify hosted cron wake reads:

- Prefer `runAssistantAutomationPass` output as the assistant lane's next-wake
  projection.
- Keep only one preflight read needed to decide whether a due workspace wake
  should enter the assistant lane before idle/system work.
- Remove duplicated cron wake merging in `workspace-assistant-phase`.

The hosted runtime should ask one question: "should the assistant lane run now,
and when does it need to wake next?" It should not reimplement reminder
scheduling.

## Expected Deletions

- Generic hosted assistant notification event contracts, builders, parsers, and
  routing.
- Runtime generic `dispatch-assistant-notification` lane.
- Device-sync reconnect notice producer, logs, tests, and event codes.
- E2E helper paths that create signup welcome through
  `assistant.notification.requested`.
- Ambiguous `automation-cron` attribution for non-cron system messages.

## Verification

Use staged verification because this touches hosted contracts, web producers,
runtime routing, and Cloudflare E2Es.

Focused checks:

- `pnpm --dir packages/hosted-execution test`
- `pnpm --dir packages/assistant-runtime test`
- `pnpm --dir apps/web test`
- `pnpm --dir apps/cloudflare test`

Scenario proof:

- Hosted local signup/first-contact E2E proves activation sends the welcome and
  does not repeat it.
- Hosted local onboarding follow-up E2E proves the follow-up automation is still
  seeded after accepted welcome delivery.
- Hosted local Linq scheduled reminder E2E still proves flex.
- Hosted local Telegram scheduled reminder E2E gains the same flex assertion.

Final acceptance should use the normal scoped lane for the touched files first:

```bash
pnpm test:diff <changed paths>
```

Escalate to full acceptance if the diff becomes broader than the paths above.

## Deployment Concerns

This change crosses `apps/web`, `packages/hosted-execution`,
`packages/assistant-runtime`, and `apps/cloudflare`.

Use a two-release compatibility window:

1. Deploy consumers first: hosted runtime accepts both the old generic
   notification wake and the new `member.activated` embedded welcome payload.
2. Deploy producers second: web emits the embedded activation payload and stops
   creating `assistant.notification.requested` for signup welcome.
3. Delete old generic support only after old mailbox rows have drained and
   production logs show no generic notification wakes remain.

No compatibility window is needed for deleting future device reconnect notices
once callers are removed, because those are web-produced automatic messages and
the product decision is to stop producing them.

## Working Set

- `packages/hosted-execution/src/contracts.ts`
- `packages/hosted-execution/src/builders.ts`
- `packages/hosted-execution/src/parsers.ts`
- `packages/assistant-runtime/src/hosted-runtime/events.ts`
- `packages/assistant-runtime/src/hosted-runtime/mailbox-routing.ts`
- `packages/assistant-runtime/src/hosted-runtime/system-mailbox.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts`
- `apps/web/src/lib/hosted-onboarding/member-activation.ts`
- `apps/web/src/lib/device-sync/hosted-runtime-authority.ts`
- `apps/web/src/lib/device-sync/reconnect-notice.ts`
- `apps/cloudflare/test/*first-contact*`
- `apps/cloudflare/test/*scheduled-reminder*`
- matching hosted-execution, assistant-runtime, and apps/web tests

State:
- Planned.
