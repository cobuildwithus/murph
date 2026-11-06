# Attribute progress-stall alerts to sampled lane heads

Status: completed
Created: 2026-10-18
Updated: 2026-10-18

## Goal

Make a future runtime-progress alert or reminder attributable to the exact lane
heads its health sample counted and to the actual sampling instant, without
changing the email or persisted incident state.

## Evidence

The monitor holds each stalled lane's runtime, lane and head sequence while it
claims a notification, then keeps only aggregates. The incident row stores the
admission time, not the earlier sampling instant. An unattributable production
alert could therefore not be correlated afterwards. This change does not
reconstruct any past alert.

## Scope and invariants

- Reuse the subject-scoped runtime-log store, its Web writer, redaction,
  retention and deletion. No migration, service, scheduler or new state.
- Record only after a newly built notification's claim commits. Retries that
  reuse a persisted message, coalesced or lost claims, and healthy evaluations
  record nothing.
- Schedule only through `after()`. Delivery and the cron response never wait
  on it. If `after()` cannot schedule, the observation is dropped. No new
  write starts after a 10-second budget, which is not an end-to-end timeout.
- Keep samples off the serializable health result. The email, incident details
  and cron response must not gain identifiers or sequences.
- Bound the observation to 20 oldest stalled lanes with overflow and
  truncation markers.
- Deploy Web before any Worker built from this change (shared event enum in
  Worker protocol admission).

## Tasks

1. Add the bounded in-memory sample and the post-claim scheduling hook.
2. Add the event code and contract docs.
3. Prove binding, caps, no-emission paths, retry non-rebinding, delivery
   independence, parser acceptance and exposure privacy with synthetic tests.
4. Run focused tests and affected typechecks. Independent review and
   exact-head CI follow the completion workflow.

## Verification

- Focused Web suites (progress, device-import, starter-abuse,
  usage-overshoot, protocol admission, runtime-log write): 75 tests pass.
  These include:
  - binding with advancing clocks (log holds the claimed sampling instant
    and head; entry time and email hold the later admission);
  - a reminder recording a new incident and sample;
  - the cap, no-emission, retry, delivery-isolation, default-scheduler-drop,
    parser and exposure-privacy cases.
  Mutations removing the retry guard or restoring an immediate-run fallback
  each fail their test.
- Shared runtime-control/runtime-log tests and the Cloudflare Web-protocol
  admission test pass, including Web-first admission for the new code.
- Shared, Web and Cloudflare typechecks, docs drift/gardening, diff check
  and the complexity guard pass.
- Final ReviewGPT round 1 (GPT-6 Pro, guarded full snapshot) passed on the
  first-reviewed head with zero findings. The closing commit only archives
  this plan.
- Exact-head CI is recorded on the PR.
Completed: 2026-10-18
