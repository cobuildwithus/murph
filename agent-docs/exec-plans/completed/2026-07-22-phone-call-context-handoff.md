# Fold hosted phone-call results into conversation context

Status: completed
Created: 2026-07-22
Updated: 2026-07-22

## Goal

- Stop completed hosted phone calls from generating an unsolicited standalone
  assistant message.
- Make the bounded call result available to the resident assistant conversation
  so the next attended turn can continue naturally from the call outcome.

## Success criteria

- A completed call queues a context-only handoff and never requests an outbound
  response by itself.
- The handoff stays on the resident conversation thread, invalidates stale
  provider-native resume, and survives checkpoint persistence for the next
  attended turn.
- Provider-controlled call text remains quoted, untrusted context and cannot
  authorize tools, delivery, or another phone call.
- Focused tests prove no detached notification is created and the next ordinary
  turn retains the call result and prior conversation context.
- Required verification, coverage review, CI, and ReviewGPT pass for the exact
  PR head.

## Root-cause evidence

- Production chronology shows the call-result mailbox item was a required-send
  system notification. Its detached turn delivered first; the following
  attended turn then asked for context that the detached turn was intentionally
  forbidden to persist into the resident conversation.
- The resident conversation recovered its older task context on the following
  turn, so the evidence does not support a general session-handoff truncation.
- Static tracing confirms the web result writer emits
  `assistant.notification.requested`, whose engine profile is isolated-thread,
  output-only, and native-resume-disabled by contract.

## Constraints

- Keep detached notifications isolated; they remain the correct primitive for
  genuine output-only system notices.
- Web remains the durable owner of phone-call rows and encrypted results.
- Do not add a second queue, polling loop, persisted context table, or new
  outbound message path.
- Preserve fresh foreground input priority and existing mailbox idempotency.
- Keep all provider-derived data bounded, quoted, and non-authoritative.
- Preserve unrelated active work in shared hosted mailbox/runtime files.

## Tasks

1. Trace the exact production chronology and prove the failing boundary.
2. Define the smallest mailbox/runtime contract for a phone-call context-only
   handoff.
3. Implement the web producer and resident-thread, no-delivery runtime consumer
   without starting a provider turn or exposing side-effect capabilities.
4. Add focused unit/integration coverage for routing, idempotency, isolation,
   persistence, and next-turn continuity.
5. Update the current hosted runtime/security documentation for the new
   boundary and rollout compatibility.
6. Complete canonical verification, coverage review, parent final review,
   scoped commit, PR, CI, and ReviewGPT.

## Working set

- `apps/web/src/lib/phone-calls/result.ts`
- focused hosted phone-call result tests under `apps/web/test/`
- `apps/cloudflare/test/hosted-local-retell-call-result-roundtrip-e2e.test.ts`
- `packages/hosted-execution/src/` mailbox event contracts and tests
- `packages/assistant-runtime/src/hosted-runtime/events/` and focused tests
- `packages/assistant-engine/src/assistant/` internal resident-context helper
  and focused tests
- `packages/assistant-engine/src/assistant-codex/dynamic-tools.ts` phone-call
  start result guidance and its focused test
- current hosted runtime/security protocol documentation

## Deployment shape

- Deploy the Cloudflare/runner consumer first with
  `container_rollout=immediate`, prove the new runner fingerprint and absence of
  mailbox parse failures, and deploy Web second. An old runner cannot parse the
  new durable event; the first compatible runner is the rollback floor while
  Web can produce it or an event remains durable/imported. A new runner accepts
  the older Web notification event during the deployment window.

## Verification evidence

- Focused phone-call producer, route, resident-context, turn-planning, runtime
  consumer, mailbox-routing, and hosted-contract suites pass.
- Focused Assistant Engine and Web typechecks pass after the final context-role
  and replay-timestamp changes.
- `pnpm test:scenario-integrity` passes for the complete scenario manifest.
- The coverage-write audit added replay coverage proving that an idempotent
  duplicate clears a newer native-resume checkpoint without appending a second
  context entry.
- `pnpm verify:acceptance` passes, including workspace typechecks, repository
  guards, full package coverage, Web and Cloudflare verification, and app builds.
- The broad `pnpm test:diff` owner suites passed, but its separate CLI-package
  subprocess lane timed out while spawning existing CLI scenarios; the same CLI
  coverage completed successfully in `pnpm verify:acceptance`.
Completed: 2026-07-22
