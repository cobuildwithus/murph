# Assistant-notification validation telemetry

Status: active
Created: 2026-08-29
Updated: 2026-08-29

## Goal

Attribute each hosted `ASSISTANT_NOTIFICATION_INVALID_RESPONSE` retry warning to
its exact current validation boundary using one closed, privacy-safe field on
the existing `mailbox.system_processed` log, without changing notification
behavior or durable state.

## Success criteria

- Every current throw site for `ASSISTANT_NOTIFICATION_INVALID_RESPONSE` carries
  exactly one compile-time closed validation reason.
- The reason survives the existing assistant-notification error context and
  structured-redaction boundary into the existing system-mailbox warning.
- Provider output, prompts, messages, payloads, identifiers, paths, stacks, raw
  errors, and free-form reason values cannot enter the emitted field.
- Existing error codes and messages, retryability, attempt increments,
  one-minute retry scheduling, wake ownership, delivery, and persisted mailbox
  state remain unchanged.
- Focused owner-package tests cover all four validation branches, redaction,
  retry preparation, durable-state exclusion, and warning emission.
- The hosted-runtime observability contract documents the vocabulary, privacy
  boundary, zero-volume-change claim, and bounded post-deploy query.

## Scope

- In scope:
  - `packages/assistant-engine/src/assistant/notification-turn.ts`
  - `packages/hosted-execution/src/observability.ts`
  - `packages/assistant-runtime/src/hosted-runtime/system-mailbox.ts`
  - `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts`
  - focused tests in those owning packages
  - `docs/hosted-runtime-log-database.md`
  - this execution plan
- Out of scope:
  - retry caps, drops, reclassification, rescheduling, or terminalization
  - device-sync code or behavior
  - new events, success-path logs, metrics, backends, tables, queues, schedulers,
    alerts, requests, timers, persistence, configuration, or migrations
  - provider, user-visible, canonical-state, auth, billing, or delivery changes

## Constraints

- Base implementation packet: `5cb8a299b41ba8d097bd1401364d83c28e2132db`.
- The vocabulary is exactly:
  - `decision_json_unparseable`
  - `decision_schema_invalid`
  - `runtime_presentation_non_send_decision`
  - `creative_response_media_invalid`
- The field name is
  `assistantNotificationValidationFailureReason` and remains optional for
  old/new runner schema compatibility.
- No private response content or distinctive scenario data may be logged.
- No `as any`, `as unknown`, or double assertion is permitted.
- The deployment is Cloudflare-hosted-runner-only and code-only reversible.

## Risks and mitigations

1. Risk: an unconstrained string turns provider content into high-cardinality
   telemetry.
   Mitigation: define the literals once in hosted-execution, expose a type guard,
   and omit values outside that exact vocabulary at the redaction boundary.
2. Risk: adding telemetry accidentally changes mailbox retry state.
   Mitigation: derive the reason after the existing normalized failure, return it
   only in ephemeral checkpoint preparation, and assert it is absent from the
   persisted pending item while the existing retry timestamp remains exact.
3. Risk: mixed old/new runners produce missing fields during rollout.
   Mitigation: keep the field optional and query missing values as `NULL`; do not
   require a migration or synchronized consumer deployment.
4. Risk: verification creates user-visible or production traffic.
   Mitigation: use synthetic local tests before deploy and natural traffic only
   after serving-revision proof.

## Tasks

1. [x] Enumerate every current `ASSISTANT_NOTIFICATION_INVALID_RESPONSE` throw
   site and derive the four-value semantic vocabulary.
2. [x] Attach the typed reason to the existing `VaultCliError` context without
   changing codes, messages, or control flow.
3. [x] Allow only the closed values through hosted-execution structured
   redaction and carry the result through retry preparation.
4. [x] Add the optional field to the existing `mailbox.system_processed`
   warning without adding log volume or persistence.
5. [x] Add focused synthetic tests for all validators, privacy filtering,
   retry scheduling/state, and warning propagation.
6. [x] Update the durable hosted-runtime observability contract.
7. [ ] Merge through the public repository review path and deploy only through
   the protected Cloudflare hosted-runner workflow.
8. [ ] Prove the serving Cloudflare hosted-runner revision after deployment.
9. [ ] Wait for natural traffic, then run the fixed latest/predecessor four-hour,
   rolling 24-hour, and rolling seven-day aggregate queries documented in
   `docs/hosted-runtime-log-database.md`.
10. [ ] Record zero events when there is no natural recurrence; do not generate
    production traffic.

## Decisions

- Product UX is not applicable: the PR is telemetry-only and has no user-visible
  state, copy, interaction, or delivery change.
- ReviewGPT authored the production patch.
- The PR is telemetry-only.
- The ordinary system-mailbox retry owner remains unchanged until root cause is
  known.
- The field is ephemeral observability, not canonical or durable mailbox state.
- No Vercel tandem deployment is required or permitted for this patch.

## Verification

Run from an exact repository checkout with dependencies installed:

```bash
pnpm --dir packages/hosted-execution test -- \
  test/hosted-execution-observability-side-effects.test.ts
pnpm --dir packages/assistant-engine test -- \
  test/assistant-notification-turn-runtime.test.ts
pnpm --dir packages/assistant-runtime test -- \
  test/hosted-runtime-system-mailbox-notification.test.ts \
  test/hosted-runtime-workspace-assistant-phase-delivery.test.ts
pnpm --dir packages/hosted-execution typecheck
pnpm --dir packages/assistant-engine typecheck
pnpm --dir packages/assistant-runtime typecheck
pnpm docs:drift
pnpm docs:gardening
```

Expected outcomes:

- all four reason assertions pass with unchanged error codes and messages;
- hostile/private marker strings are absent after redaction and retry
  preparation;
- the pending mailbox item retains the existing one-minute retry and contains no
  telemetry field;
- the existing `mailbox.system_processed` warning carries the closed reason
  in its `redactedJson`;
- all touched packages typecheck and documentation guards pass.

Candidate evidence:

- Accepted ReviewGPT implementation artifact SHA-256:
  `ae7d3cedcb90c32dd3d4837dfcb4ed89640e84b849668b7500db56e528c67015`.
- Passed focused Vitest: 29 hosted-execution privacy/redaction tests, 80
  assistant-engine notification-validator tests, and 141 assistant-runtime
  system-mailbox and warning-emission tests.
- Passed affected-package typechecks for `hosted-execution`,
  `assistant-engine`, and `assistant-runtime`.
- Passed raw-log privacy, provider-request boundary, agent-doc drift,
  documentation gardening, and diff-hygiene guards.
- Parent inspection accepted every implementation hunk without modification:
  the parser remains behavior-equivalent, annotation preserves the typed error
  context, the retry delay and durable state are unchanged, and no device-sync
  path is modified.

## Deployment and rollback

1. Merge the public repository PR after required review and exact-head checks.
2. Deploy through the protected Cloudflare hosted-runner workflow only.
3. Prove the serving revision before interpreting natural-traffic results.
4. Do not deploy Vercel, run a migration, add a binding or secret, change a
   permission, queue, or configuration, or coordinate a tandem rollout.
5. Roll back by redeploying the prior Cloudflare hosted-runner revision. The
   optional field requires no data rollback, migration reversal, or consumer
   coordination.

## Post-deploy observation

Use one fixed observation end timestamp. Run the documented aggregate query for
these four windows:

1. latest four hours: `[end - 4h, end)`;
2. predecessor four hours: `[end - 8h, end - 4h)`;
3. rolling 24 hours: `[end - 24h, end)`;
4. rolling seven days: `[end - 7d, end)`.

Filter only `event_code = 'mailbox.system_processed'` and
`error_code = 'ASSISTANT_NOTIFICATION_INVALID_RESPONSE'`. Group only by the
closed reason, `status`, `wakeKind`, and `routeAction`; return event count,
privacy-safe distinct-subject count, minimum/maximum attempt count, and
first/last timestamps. Never return subject keys or raw JSON.
